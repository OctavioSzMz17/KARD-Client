/**
 * Prueba del cliente PC-02 — LoginComponent
 * (ver docs/Pruebas_IEEE829.md en el repositorio del backend)
 *
 * Verifica la validación en el cliente antes de gastar una petición al
 * servidor, y el mecanismo de doble intento: como la plataforma tiene dos
 * identidades separadas, el formulario prueba primero como negocio y, si
 * las credenciales no existen ahí, reintenta como cliente.
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { LoginComponent } from './login.component';

describe('PC-02 · LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let httpMock: HttpTestingController;
  let router: Router;

  const API = 'http://localhost:8000/api/v1';

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);

    // El componente redirige tras un login exitoso. Se intercepta la
    // navegación: sin esto el router de prueba no encuentra la ruta y
    // lanza NG04002 fuera del ciclo de la prueba.
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture.detectChanges();
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('el formulario arranca inválido y vacío', () => {
    expect(component.form.invalid).toBe(true);
  });

  it('no envía nada al servidor si el formulario está vacío', () => {
    component.onSubmit();

    // La verificación real: no se disparó ninguna petición HTTP
    httpMock.expectNone(`${API}/auth/login`);
    expect(component.loading()).toBe(false);
  });

  it('rechaza un correo con formato inválido sin llamar a la API', () => {
    component.form.setValue({ email: 'esto-no-es-un-correo', password: 'testpass123!' });

    expect(component.form.invalid).toBe(true);
    component.onSubmit();
    httpMock.expectNone(`${API}/auth/login`);
  });

  it('con credenciales válidas sí llama al endpoint de negocio', () => {
    component.form.setValue({ email: 'admin@sabor-norteno.com', password: 'testpass123!' });
    expect(component.form.valid).toBe(true);

    component.onSubmit();

    const req = httpMock.expectOne(`${API}/auth/login`);
    expect(req.request.body).toEqual({
      email: 'admin@sabor-norteno.com',
      password: 'testpass123!'
    });
    req.flush({
      access_token: 't', token_type: 'bearer', user_id: 'u_1',
      tenant_id: 't_1', role: 'business_admin', business_type: 'restaurant'
    });

    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });

  it('si el negocio devuelve 401, reintenta como cliente B2C', () => {
    component.form.setValue({ email: 'cliente@kard.dev', password: 'testpass123!' });
    component.onSubmit();

    // Primer intento: identidad de negocio → no existe
    httpMock.expectOne(`${API}/auth/login`).flush(
      { error: 'Invalid email or password' },
      { status: 401, statusText: 'Unauthorized' }
    );

    // Segundo intento: identidad de cliente
    const reqConsumer = httpMock.expectOne(`${API}/consumers/login`);
    expect(reqConsumer.request.method).toBe('POST');
    reqConsumer.flush({ access_token: 't', token_type: 'bearer', consumer_id: 'con_1' });

    // Cada identidad aterriza en su propia zona de la aplicación
    expect(router.navigate).toHaveBeenCalledWith(['/explore']);
  });

  it('muestra un mensaje si ninguna de las dos identidades reconoce las credenciales', () => {
    component.form.setValue({ email: 'nadie@kard.dev', password: 'testpass123!' });
    component.onSubmit();

    httpMock.expectOne(`${API}/auth/login`).flush({}, { status: 401, statusText: 'Unauthorized' });
    httpMock.expectOne(`${API}/consumers/login`).flush({}, { status: 401, statusText: 'Unauthorized' });

    expect(component.error()).not.toBe('');
    expect(component.loading()).toBe(false);
  });
});
