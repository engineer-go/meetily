'use client';

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import { Check, Plus, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

export type TemplateFormat = 'paragraph' | 'list' | 'string';

export interface TemplateSection {
  title: string;
  instruction: string;
  format: TemplateFormat;
  item_format?: string | null;
  example_item_format?: string | null;
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  is_custom: boolean;
}

export interface TemplateDetails extends TemplateInfo {
  sections: TemplateSection[];
}

interface SummaryTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: TemplateInfo[];
  selectedTemplateId: string;
  onSelect: (templateId: string, templateName: string) => void;
  onTemplatesChanged: () => Promise<void> | void;
}

const FORMAT_OPTIONS: Array<{ value: TemplateFormat; label: string }> = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'list', label: 'List' },
  { value: 'string', label: 'Single line' },
];

function emptySection(): TemplateSection {
  return {
    title: 'New section',
    instruction: 'Describe what the model should extract here.',
    format: 'list',
  };
}

function slugifyTemplateId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'custom_template';
}

function isTemplateFormat(value: string): value is TemplateFormat {
  return value === 'paragraph' || value === 'list' || value === 'string';
}

function normalizeDetails(details: TemplateDetails): TemplateDetails {
  return {
    ...details,
    sections: details.sections.map((section) => ({
      ...section,
      format: isTemplateFormat(section.format) ? section.format : 'paragraph',
    })),
  };
}

function uniqueTemplateId(name: string, existingIds: Set<string>): string {
  const base = slugifyTemplateId(name);
  if (!existingIds.has(base)) {
    return base;
  }
  let suffix = 2;
  let candidate = `${base}_${suffix}`;
  while (existingIds.has(candidate)) {
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
  return candidate;
}

export function SummaryTemplateDialog({
  open,
  onOpenChange,
  templates,
  selectedTemplateId,
  onSelect,
  onTemplatesChanged,
}: SummaryTemplateDialogProps) {
  const [activeId, setActiveId] = useState(selectedTemplateId);
  const [draft, setDraft] = useState<TemplateDetails | null>(null);
  const [isUnsaved, setIsUnsaved] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadDetails = useCallback(async (templateId: string) => {
    setLoading(true);
    try {
      const details = await invoke<TemplateDetails>('api_get_template_details', { templateId });
      setDraft(normalizeDetails(details));
      setActiveId(details.id);
      setIsUnsaved(false);
    } catch (error) {
      console.error('Failed to load template:', error);
      toast.error('Failed to load template', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setIsUnsaved(false);
      return;
    }
    const initialId = selectedTemplateId || templates[0]?.id;
    if (initialId) {
      void loadDetails(initialId);
    } else {
      setDraft(null);
    }
    // Load the current selection only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- selectedTemplateId/templates are read at open time
  }, [open, loadDetails]);

  const startNewTemplate = () => {
    const id = uniqueTemplateId('My template', new Set(templates.map((t) => t.id)));
    setActiveId(id);
    setIsUnsaved(true);
    setDraft({
      id,
      name: 'My template',
      description: 'Custom summary template',
      is_custom: true,
      sections: [emptySection()],
    });
  };

  const updateDraft = (patch: Partial<TemplateDetails>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setIsUnsaved(true);
  };

  const updateSection = (index: number, patch: Partial<TemplateSection>) => {
    setDraft((prev) => {
      if (!prev) {
        return prev;
      }
      const sections = prev.sections.map((section, i) =>
        i === index ? { ...section, ...patch } : section
      );
      return { ...prev, sections };
    });
    setIsUnsaved(true);
  };

  const addSection = () => {
    setDraft((prev) =>
      prev ? { ...prev, sections: [...prev.sections, emptySection()] } : prev
    );
    setIsUnsaved(true);
  };

  const removeSection = (index: number) => {
    setDraft((prev) => {
      if (!prev) {
        return prev;
      }
      return { ...prev, sections: prev.sections.filter((_, i) => i !== index) };
    });
    setIsUnsaved(true);
  };

  const handleSave = async () => {
    if (!draft) {
      return;
    }
    const name = draft.name.trim();
    const description = draft.description.trim();
    if (!name) {
      toast.error('Template name is required');
      return;
    }
    if (!description) {
      toast.error('Template description is required');
      return;
    }
    if (draft.sections.length === 0) {
      toast.error('Add at least one section before saving');
      return;
    }
    const invalidSection = draft.sections.findIndex(
      (section) => !section.title.trim() || !section.instruction.trim()
    );
    if (invalidSection >= 0) {
      toast.error(`Section ${invalidSection + 1} needs a title and instruction`);
      return;
    }

    setSaving(true);
    try {
      const existingIds = new Set(templates.map((template) => template.id));
      const creatingNew = !existingIds.has(draft.id);
      const idToSave = creatingNew
        ? uniqueTemplateId(name, existingIds)
        : draft.id;
      const saved = await invoke<TemplateInfo>('api_save_custom_template', {
        id: idToSave,
        name,
        description,
        sections: draft.sections.map((section) => ({
          title: section.title.trim(),
          instruction: section.instruction.trim(),
          format: section.format,
          item_format: section.item_format?.trim() || null,
          example_item_format: section.example_item_format?.trim() || null,
        })),
      });
      toast.success(creatingNew ? 'Template added' : 'Template saved', {
        description: saved.name,
      });
      setIsUnsaved(false);
      await onTemplatesChanged();
      onSelect(saved.id, saved.name);
      await loadDetails(saved.id);
    } catch (error) {
      console.error('Failed to save template:', error);
      toast.error('Failed to save template', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const isNewDraft =
    Boolean(draft) && !templates.some((template) => template.id === draft?.id);

  const handleDelete = async () => {
    if (!draft?.is_custom || isNewDraft) {
      return;
    }
    setSaving(true);
    try {
      await invoke('api_delete_custom_template', { templateId: draft.id });
      toast.success('Template deleted');
      await onTemplatesChanged();
      const fallback = templates.find((t) => t.id !== draft.id) ?? templates[0];
      if (fallback) {
        onSelect(fallback.id, fallback.name);
        await loadDetails(fallback.id);
      } else {
        setDraft(null);
      }
    } catch (error) {
      console.error('Failed to delete template:', error);
      toast.error('Failed to delete template', {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleUse = () => {
    if (!draft || isUnsaved) {
      return;
    }
    onSelect(draft.id, draft.name);
    onOpenChange(false);
  };

  const sidebarTemplates: TemplateInfo[] =
    draft && isNewDraft
      ? [
          ...templates,
          {
            id: draft.id,
            name: draft.name,
            description: draft.description,
            is_custom: true,
          },
        ]
      : templates;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col max-w-4xl h-[min(85vh,720px)] overflow-hidden p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <DialogTitle>Summary templates</DialogTitle>
          <DialogDescription>
            Choose a template, edit sections, or add your own. Save at any time to add or update a custom template.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[220px_1fr] flex-1 min-h-0 border-t">
          <div className="border-r bg-gray-50 flex flex-col min-h-0">
            <div className="p-2 shrink-0">
              <Button variant="outline" size="sm" className="w-full justify-start" onClick={startNewTemplate}>
                <Plus className="h-4 w-4 mr-1" />
                Add template
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
              {sidebarTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => {
                    if (isUnsaved && template.id === draft?.id) {
                      setActiveId(template.id);
                      return;
                    }
                    void loadDetails(template.id);
                  }}
                  className={`w-full text-left rounded-md px-2 py-2 text-sm ${
                    activeId === template.id
                      ? 'bg-white shadow-sm ring-1 ring-blue-200'
                      : 'hover:bg-white/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-medium truncate">{template.name}</span>
                    {selectedTemplateId === template.id && (
                      <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
                    )}
                  </div>
                  <div className="text-xs text-gray-500 truncate">{template.description}</div>
                  {isUnsaved && template.id === draft?.id ? (
                    <div className="text-[10px] uppercase tracking-wide text-amber-600 mt-0.5">Unsaved</div>
                  ) : template.is_custom ? (
                    <div className="text-[10px] uppercase tracking-wide text-blue-600 mt-0.5">Custom</div>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col min-h-0 min-w-0">
            {loading || !draft ? (
              <p className="text-sm text-gray-500 p-5">
                {loading ? 'Loading template…' : 'Select or add a template.'}
              </p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3 px-5 py-3 border-b shrink-0 bg-white">
                  <p className="text-sm text-gray-600 truncate">
                    {isNewDraft
                      ? 'Click Save at any time to add this template.'
                      : isUnsaved
                        ? 'Unsaved changes — click Save to keep them.'
                        : draft.is_custom
                          ? 'Custom template'
                          : 'Built-in template — Save stores a custom copy.'}
                  </p>
                  <Button onClick={() => void handleSave()} disabled={saving}>
                    {saving ? 'Saving…' : 'Save'}
                  </Button>
                </div>

                <div className="overflow-y-auto p-5 space-y-4 flex-1 min-h-0">
                  <div className="space-y-2">
                    <Label htmlFor="template-name">Name</Label>
                    <Input
                      id="template-name"
                      value={draft.name}
                      onChange={(event) => updateDraft({ name: event.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="template-description">Description</Label>
                    <Textarea
                      id="template-description"
                      value={draft.description}
                      onChange={(event) => updateDraft({ description: event.target.value })}
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <Label>Sections</Label>
                    <Button variant="outline" size="sm" onClick={addSection}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add section
                    </Button>
                  </div>

                  <div className="space-y-3">
                    {draft.sections.length === 0 ? (
                      <div className="border border-dashed rounded-lg p-4 text-sm text-gray-500">
                        No sections. Add a section, then save the template.
                      </div>
                    ) : (
                      draft.sections.map((section, index) => (
                        <div key={`${draft.id}-${index}`} className="border rounded-lg p-3 space-y-2 bg-white">
                          <div className="flex gap-2 items-center">
                            <Input
                              className="min-w-0 flex-1"
                              value={section.title}
                              onChange={(event) => updateSection(index, { title: event.target.value })}
                              placeholder="Section title"
                            />
                            <select
                              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm shrink-0"
                              value={section.format}
                              onChange={(event) => {
                                const next = event.target.value;
                                if (isTemplateFormat(next)) {
                                  updateSection(index, { format: next });
                                }
                              }}
                            >
                              {FORMAT_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <Button
                              variant="outline"
                              size="sm"
                              className="shrink-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                              onClick={() => removeSection(index)}
                              title="Delete section"
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Delete
                            </Button>
                          </div>
                          <Textarea
                            value={section.instruction}
                            onChange={(event) => updateSection(index, { instruction: event.target.value })}
                            placeholder="Instruction for the model"
                          />
                          {section.format === 'list' && (
                            <Input
                              value={section.item_format ?? ''}
                              onChange={(event) => updateSection(index, { item_format: event.target.value })}
                              placeholder="Optional list/table format"
                            />
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0 sm:justify-between">
          {draft?.is_custom && !isNewDraft ? (
            <Button variant="outline" onClick={() => void handleDelete()} disabled={saving}>
              Delete template
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              variant="outline"
              onClick={handleUse}
              disabled={!draft || isUnsaved}
              title={isUnsaved ? 'Save the template before using it' : 'Use this template'}
            >
              Use template
            </Button>
            <Button onClick={() => void handleSave()} disabled={!draft || saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
