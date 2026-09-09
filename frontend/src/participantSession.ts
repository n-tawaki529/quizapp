import { isInvalidParticipantError, participantApi } from "./api";
import { ParticipantSession } from "./types";

function key(eventId: string): string {
  return `participant_${eventId}`;
}

export function getParticipantSession(eventId: string): ParticipantSession | null {
  const raw = localStorage.getItem(key(eventId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ParticipantSession;
  } catch {
    return null;
  }
}

export function setParticipantSession(session: ParticipantSession) {
  localStorage.setItem(key(session.event_id), JSON.stringify(session));
}

export function clearParticipantSession(eventId: string) {
  localStorage.removeItem(key(eventId));
}

export async function validateParticipantSession(eventId: string, session: ParticipantSession): Promise<boolean> {
  try {
    await participantApi.get<{ valid: boolean }>(`/api/events/${eventId}/participant/me`, session.token);
    return true;
  } catch (error) {
    if (isInvalidParticipantError(error)) return false;
    throw error;
  }
}
