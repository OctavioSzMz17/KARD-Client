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
  // Quién es dentro del negocio y qué puede hacer (los manda el servidor).
  position?: string;
  position_label?: string;
  full_name?: string | null;
  employee_code?: string | null;
  permissions?: string[];
}

export interface ConsumerLoginResponse {
  access_token: string;
  token_type: string;
  consumer_id: string;
}

/** Auto-registro de un negocio (POST /auth/register-tenant). */
export interface TenantRegisterRequest {
  business_name: string;
  business_type: 'restaurant' | 'optician';
  email: string;
  password: string;
}

/** Trae el JWT ya emitido: el dueño entra directo a su panel. */
export interface TenantRegisterResponse {
  access_token: string;
  token_type: string;
  user_id: string;
  tenant_id: string;
  role: string;
  business_type: string;
  slug: string;
  position?: string;
  position_label?: string;
  full_name?: string | null;
  employee_code?: string | null;
  permissions?: string[];
}

/** Registro de un cliente (POST /consumers/register). El nombre es opcional. */
export interface ConsumerRegisterRequest {
  email: string;
  password: string;
  name?: string;
}

export interface ApiError {
  success: false;
  error: string;
}
