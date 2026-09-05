export type EventStatus = "CREATED" | "WAITING" | "RUNNING" | "FINISHED";
export type QuizPhase =
  | "NOT_STARTED"
  | "QUESTION_SHOWN"
  | "ANSWER_OPEN"
  | "ANSWER_CLOSED"
  | "ANSWER_COUNT_SHOWN"
  | "CORRECT_ANSWER_SHOWN"
  | "RANKING";

export type ChoiceKey = "A" | "B" | "C" | "D";
export type MediaType = "NONE" | "IMAGE" | "VIDEO";
export type ChoiceContentType = "TEXT" | "IMAGE" | "VIDEO";

export interface EventSummary {
  id: string;
  name: string;
  status: EventStatus;
  phase: QuizPhase;
  created_at: string;
}

export interface EventAdminDetail extends EventSummary {
  participant_count: number;
  question_count: number;
  current_question_number: number | null;
}

export interface ChoiceOut {
  choice_key: ChoiceKey;
  content_type: ChoiceContentType;
  text: string | null;
  media_url: string | null;
}

export interface QuestionAdminOut {
  id: string;
  question_number: number;
  question_text: string;
  question_media_type: MediaType;
  question_media_url: string | null;
  time_limit_seconds: number;
  correct_choice: ChoiceKey;
  choices: ChoiceOut[];
}

export interface RankingEntry {
  rank: number;
  participant_id: string;
  name: string;
  correct_count: number;
  total_response_time_ms: number;
}

export interface MonitorQuestionState {
  id: string;
  question_number: number;
  question_text: string;
  question_media_type: MediaType;
  question_media_url: string | null;
  time_limit_seconds: number;
  choices: ChoiceOut[];
}

export interface MonitorState {
  type: string;
  role: "monitor" | "admin";
  event_id: string;
  event_name?: string;
  event_status?: EventStatus;
  phase: QuizPhase;
  answer_started_at: string | null;
  answer_deadline: string | null;
  remaining_ms: number | null;
  server_time: string;
  question: MonitorQuestionState | null;
  ranking: RankingEntry[] | null;
  answer_counts: Record<ChoiceKey, number> | null;
  correct_choice: ChoiceKey | null;
  participant_count?: number;
  answered_count?: number;
  connected_participant_count?: number;
  top_ranking?: RankingEntry[];
}

export interface ParticipantQuestionState {
  id: string;
  question_number: number;
  question_text: string;
  choice_keys: ChoiceKey[];
}

export interface ParticipantState {
  type: string;
  role: "participant";
  event_id: string;
  phase: QuizPhase;
  answer_deadline: string | null;
  remaining_ms: number | null;
  server_time: string;
  question: ParticipantQuestionState | null;
  already_answered: boolean;
  correct_count: number;
}

export interface ParticipantSession {
  participant_id: string;
  token: string;
  name: string;
  event_id: string;
}
