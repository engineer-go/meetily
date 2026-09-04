"use client";

import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import { openMeetingDetails } from "@/lib/meetingNavigation";

export const useNavigation = (meetingId: string, meetingTitle: string) => {
    const { setCurrentMeeting } = useSidebar();

    const handleNavigation = () => {
        setCurrentMeeting({ id: meetingId, title: meetingTitle });
        openMeetingDetails(meetingId);
    };

    return handleNavigation;
};
