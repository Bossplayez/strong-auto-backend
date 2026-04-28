import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { getAccessToken, getRefreshToken, setTokens, clearTokens } from './auth';
import type {
  AuthTokens,
  CalculatorEstimate,
  CalculatorInput,
  CreateLeadDto,
  FilterOptions,
  Lead,
  LeadStatus,
  NewsArticle,
  PaginatedResponse,
  UpdateProfileDto,
  User,
  Vehicle,
  VehicleFilters,
} from './types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
});

// Attach access token to every request
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken();
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-refresh on 401
let refreshPromise: Promise<AuthTokens> | null = null;

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = getRefreshToken();
      if (!refreshToken) {
        clearTokens();
        return Promise.reject(error);
      }

      try {
        // Deduplicate concurrent refresh calls
        if (!refreshPromise) {
          refreshPromise = auth.refresh(refreshToken);
        }
        const tokens = await refreshPromise;
        setTokens(tokens);
        refreshPromise = null;

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${tokens.accessToken}`;
        }
        return apiClient(originalRequest);
      } catch {
        refreshPromise = null;
        clearTokens();
        return Promise.reject(error);
      }
    }

    return Promise.reject(error);
  },
);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
export const auth = {
  async login(email: string, password: string): Promise<AuthTokens> {
    const { data } = await apiClient.post<AuthTokens>('/auth/login', { email, password });
    setTokens(data);
    return data;
  },

  async register(email: string, password: string, phone?: string): Promise<AuthTokens> {
    const { data } = await apiClient.post<AuthTokens>('/auth/register', { email, password, phone });
    setTokens(data);
    return data;
  },

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const { data } = await axios.post<AuthTokens>(`${API_BASE_URL}/auth/refresh`, { refreshToken });
    return data;
  },

  async forgotPassword(email: string): Promise<void> {
    await apiClient.post('/auth/forgot-password', { email });
  },

  async resetPassword(email: string, token: string, newPassword: string): Promise<void> {
    await apiClient.post('/auth/reset-password', { email, token, newPassword });
  },
};

// ---------------------------------------------------------------------------
// Catalog (public)
// ---------------------------------------------------------------------------
export const catalog = {
  async getVehicles(filters?: VehicleFilters): Promise<PaginatedResponse<Vehicle>> {
    const { data } = await apiClient.get<PaginatedResponse<Vehicle>>('/catalog/vehicles', { params: filters });
    return data;
  },

  async getVehicle(slug: string): Promise<Vehicle> {
    const { data } = await apiClient.get<Vehicle>(`/catalog/vehicles/${slug}`);
    return data;
  },

  async getFilterOptions(): Promise<FilterOptions> {
    const { data } = await apiClient.get<FilterOptions>('/catalog/filter-options');
    return data;
  },

  async getVehicleBids(vehicleId: string): Promise<{
    bids: Array<{ id: string; amount: number; status: string; createdAt: string; bidder: string }>;
    currentBidAmount: number | null;
    totalBids: number;
  }> {
    const { data } = await apiClient.get(`/catalog/vehicles/${vehicleId}/bids`);
    return data;
  },

  async placeBid(vehicleId: string, amount: number, maxAmount?: number): Promise<{
    id: string; amount: number; status: string; message: string;
  }> {
    const { data } = await apiClient.post(`/catalog/vehicles/${vehicleId}/bid`, { amount, maxAmount });
    return data;
  },
};

// ---------------------------------------------------------------------------
// Calculator (public)
// ---------------------------------------------------------------------------
export const calculator = {
  async estimate(input: CalculatorInput): Promise<CalculatorEstimate> {
    const { data } = await apiClient.post<CalculatorEstimate>('/calculator/estimate', input);
    return data;
  },
};

// ---------------------------------------------------------------------------
// Leads (public)
// ---------------------------------------------------------------------------
export const leads = {
  async create(dto: CreateLeadDto): Promise<Lead> {
    const { data } = await apiClient.post<Lead>('/leads', dto);
    return data;
  },
};

// ---------------------------------------------------------------------------
// News (public)
// ---------------------------------------------------------------------------
export const news = {
  async getAll(page?: number, locale?: string): Promise<PaginatedResponse<NewsArticle>> {
    const { data } = await apiClient.get<PaginatedResponse<NewsArticle>>('/news', {
      params: { page, locale },
    });
    return data;
  },

  async getBySlug(slug: string): Promise<NewsArticle> {
    const { data } = await apiClient.get<NewsArticle>(`/news/${slug}`);
    return data;
  },
};

// ---------------------------------------------------------------------------
// Me (authenticated user)
// ---------------------------------------------------------------------------
export const me = {
  async getProfile(): Promise<User> {
    const { data } = await apiClient.get<User>('/me');
    return data;
  },

  async updateProfile(dto: UpdateProfileDto): Promise<User> {
    const { data } = await apiClient.patch<User>('/me/profile', dto);
    return data;
  },

  async getFavorites(page?: number): Promise<PaginatedResponse<Vehicle>> {
    const { data } = await apiClient.get<PaginatedResponse<Vehicle>>('/me/favorites', {
      params: { page },
    });
    return data;
  },

  async addFavorite(vehicleId: string): Promise<void> {
    await apiClient.post(`/me/favorites/${vehicleId}`);
  },

  async removeFavorite(vehicleId: string): Promise<void> {
    await apiClient.delete(`/me/favorites/${vehicleId}`);
  },

  async getCalculations(page?: number): Promise<PaginatedResponse<CalculatorEstimate>> {
    const { data } = await apiClient.get<PaginatedResponse<CalculatorEstimate>>('/me/calculations', {
      params: { page },
    });
    return data;
  },

  async saveCalculation(estimateId: string): Promise<void> {
    await apiClient.post(`/me/calculations/${estimateId}/save`);
  },
};

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------
export const admin = {
  // Users
  async getUsers(page?: number): Promise<PaginatedResponse<User>> {
    const { data } = await apiClient.get<PaginatedResponse<User>>('/admin/users', { params: { page } });
    return data;
  },

  async updateUser(id: string, dto: Partial<User>): Promise<User> {
    const { data } = await apiClient.patch<User>(`/admin/users/${id}`, dto);
    return data;
  },

  // Leads
  async getLeads(query?: {
    page?: number;
    status?: LeadStatus;
    assignedToUserId?: string;
  }): Promise<PaginatedResponse<Lead>> {
    const { data } = await apiClient.get<PaginatedResponse<Lead>>('/admin/leads', { params: query });
    return data;
  },

  async getLead(id: string): Promise<Lead> {
    const { data } = await apiClient.get<Lead>(`/admin/leads/${id}`);
    return data;
  },

  async updateLead(id: string, dto: Partial<Lead>): Promise<Lead> {
    const { data } = await apiClient.patch<Lead>(`/admin/leads/${id}`, dto);
    return data;
  },

  // Vehicles
  async getVehicles(page?: number): Promise<PaginatedResponse<Vehicle>> {
    const { data } = await apiClient.get<PaginatedResponse<Vehicle>>('/admin/vehicles', {
      params: { page },
    });
    return data;
  },

  async createVehicle(dto: Partial<Vehicle>): Promise<Vehicle> {
    const { data } = await apiClient.post<Vehicle>('/admin/vehicles', dto);
    return data;
  },

  async updateVehicle(id: string, dto: Partial<Vehicle>): Promise<Vehicle> {
    const { data } = await apiClient.patch<Vehicle>(`/admin/vehicles/${id}`, dto);
    return data;
  },

  async deleteVehicle(id: string): Promise<void> {
    await apiClient.delete(`/admin/vehicles/${id}`);
  },

  async publishVehicle(id: string): Promise<Vehicle> {
    const { data } = await apiClient.post<Vehicle>(`/admin/vehicles/${id}/publish`);
    return data;
  },

  async hideVehicle(id: string): Promise<Vehicle> {
    const { data } = await apiClient.post<Vehicle>(`/admin/vehicles/${id}/hide`);
    return data;
  },

  // News
  async getNews(page?: number): Promise<PaginatedResponse<NewsArticle>> {
    const { data } = await apiClient.get<PaginatedResponse<NewsArticle>>('/admin/news', {
      params: { page },
    });
    return data;
  },

  async createNews(dto: Partial<NewsArticle>): Promise<NewsArticle> {
    const { data } = await apiClient.post<NewsArticle>('/admin/news', dto);
    return data;
  },

  async updateNews(id: string, dto: Partial<NewsArticle>): Promise<NewsArticle> {
    const { data } = await apiClient.patch<NewsArticle>(`/admin/news/${id}`, dto);
    return data;
  },

  async deleteNews(id: string): Promise<void> {
    await apiClient.delete(`/admin/news/${id}`);
  },

  // Broadcasts
  async getBroadcasts(): Promise<any> {
    const { data } = await apiClient.get('/admin/broadcasts');
    // Handle both paginated and array responses
    return data?.items || data;
  },

  async createBroadcast(dto: { subject: string; body: string; targetGroup?: string }): Promise<unknown> {
    const { data } = await apiClient.post('/admin/broadcasts', dto);
    return data;
  },

  async sendBroadcast(id: string): Promise<void> {
    await apiClient.post(`/admin/broadcasts/${id}/send`);
  },

  // Audit logs
  async getAuditLogs(page?: number): Promise<PaginatedResponse<unknown>> {
    const { data } = await apiClient.get<PaginatedResponse<unknown>>('/admin/audit-logs', {
      params: { page },
    });
    return data;
  },
};

const api = {
  catalog,
  calculator,
  leads,
  news,
  me,
  admin,
  auth,
};

export default api;
