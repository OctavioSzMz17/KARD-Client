export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  user_id: string;
  tenant_id: string;
  role: string;
  business_type: string;
}

export interface ConsumerLoginResponse {
  access_token: string;
  token_type: string;
  consumer_id: string;
}

export interface RegisterRequest {
  business_name: string;
  business_type: 'restaurant' | 'optician';
  email: string;
  phone?: string;
}

export interface RegisterResponse {
  tenant_id: string;
  business_name: string;
  business_type: string;
  email: string;
  phone?: string;
  is_active: boolean;
}

export interface ApiError {
  success: false;
  error: string;
}
