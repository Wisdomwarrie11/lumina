export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  phone: string;
  gender: 'male' | 'female' | 'other';
  createdAt: number;
  isPremium?: boolean;
}

export interface Partner {
  id: string;
  name: string;
  phone: string;
  createdAt: number;
  ownerId: string;
}

export interface Schedule {
  id: string;
  partnerId: string;
  ownerId: string;
  time: string; // HH:mm
  days: number[]; // 0-6
  message: string;
  active: boolean;
  lastSent?: number;
}

export interface MessageLog {
  id: string;
  scheduleId: string;
  ownerId: string;
  partnerName: string;
  message: string;
  sentAt: number;
  status: 'sent' | 'failed';
}

export interface Template {
  id: string;
  category: string;
  text: string;
  ownerId?: string;
  createdAt?: number;
}
