export interface UserPublic {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  isActive: boolean;
  lastLogin?: string;
  createdAt: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  errors?: Record<string, string[]>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
