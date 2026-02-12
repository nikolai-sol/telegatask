export type ChatCaptureMode = "off" | "mention_only" | "full" | "auto_scan";

export interface Chat {
  id: string; // Firestore doc id
  telegramChatId: number;
  title: string;
  type: "group" | "supergroup" | "channel" | "private";
  defaultProjectId?: string | null;

  // Auto-scan settings
  captureMode: ChatCaptureMode;
  scanIntervalMin: number; // интервал сканирования в минутах (default 30)
  lastScannedAt?: string | null; // ISO — когда последний раз сканировали

  createdAt: string;
  updatedAt: string;
}
