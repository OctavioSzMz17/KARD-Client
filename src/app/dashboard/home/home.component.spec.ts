/**
 * Prueba del cliente PC-19 — Dashboard con ventas reales (HomeComponent)
 *
 * Las gráficas del inicio salían de números aleatorios. Ahora se arman con lo que el servidor
 * dice que se vendió: se prueba que se pidan con el desfase del navegador, que lo mostrado sea
 * exactamente lo recibido, que no cambie al volver a entrar y qué se ve sin ventas, con un
 * error o sin permiso.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HomeComponent } from './home.component';
import { AuthService } from '../../core/services/auth.service';
import { PERM } from '../../core/permissions';
import { ProductStore } from '../../core/store/product.store';
import { SalesStats } from '../../core/services/sales.service';
import { linePath } from './chart-math';
import { environment } from '../../../environments/environment';

const STATS_URL = `${environment.apiUrl}/orders/business/stats`;
const esStats = (r: { url: string }) => r.url === STATS_URL;

const SEMANA = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'];

const conVentas = (): SalesStats => ({
  days: SEMANA.map((date, i) => ({ date, revenue: ['0.00', '120.00', '0.00', '340.50', '0.00', '250.00', '540.00'][i], orders: [0, 2, 0, 3, 0, 2, 4][i] })),
  top_products: [
    { product_id: 'p_1', name: 'Café de Olla', units: 9, revenue: '342.00' },
    { product_id: 'p_2', name: 'Michelada Preparada', units: 4, revenue: '340.00' },
    { product_id: 'p_3', name: 'Helado Frito', units: 1, revenue: '88.00' },
  ],
  total_revenue: '1250.50',
  total_orders: 11,
  average_ticket: '113.68',
});

const sinVentas = (): SalesStats => ({
  days: SEMANA.map(date => ({ date, revenue: '0.00', orders: 0 })),
  top_products: [],
  total_revenue: '0.00',
  total_orders: 0,
  average_ticket: null,
});

describe('PC-19 · HomeComponent con ventas reales', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(ProductStore).products.set([]);
  });

  afterEach(() => localStorage.clear());

  function abrir(permisos: string[] = [PERM.dashboardView, PERM.salesRead]) {
    TestBed.inject(AuthService).profile.set({
      kind: 'b2b', user_id: 'u_1', tenant_id: 't_1', role: 'business_admin', business_type: 'restaurant',
      position: 'dueno', position_label: 'Dueño', full_name: 'Octavio', employee_code: '0001', permissions: permisos,
    } as any);
    const fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
    // El inicio espera el catálogo antes de dibujar sus tarjetas.
    http.match(r => r.url.startsWith(`${environment.apiUrl}/products`)).forEach(r => r.flush({ items: [], total: 0, page: 1, page_size: 100 }));
    fixture.detectChanges();
    return fixture;
  }

  const responder = (fixture: ReturnType<typeof abrir>, stats: SalesStats) => {
    http.expectOne(esStats).flush(stats);
    fixture.detectChanges();
  };
  const html = (f: ReturnType<typeof abrir>) => f.nativeElement as HTMLElement;
  const trazo = (f: ReturnType<typeof abrir>) => html(f).querySelector('svg.chart path[stroke]')?.getAttribute('d');

  describe('qué pide', () => {
    it('los últimos 7 días, con el desfase de la zona horaria del navegador', () => {
      abrir();
      const req = http.expectOne(esStats);
      expect(req.request.params.get('days')).toBe('7');
      expect(req.request.params.get('tz_offset')).toBe(String(new Date().getTimezoneOffset()));
      req.flush(sinVentas());
    });

    it('con la sesión de quien lo ve', () => {
      TestBed.inject(AuthService).getToken = () => 'jwt-de-prueba';
      abrir();
      const req = http.expectOne(esStats);
      expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-de-prueba');
      req.flush(sinVentas());
    });

    it('quien no puede ver las ventas no las pide y no ve esas tarjetas', () => {
      const f = abrir([PERM.dashboardView]);
      http.expectNone(esStats);
      expect(html(f).textContent).not.toContain('Ventas de los últimos 7 días');
      expect(html(f).textContent).not.toContain('Más vendidos');
      expect(html(f).textContent).toContain('Resumen de Inventario');           // lo demás sigue ahí
    });
  });

  describe('lo que muestra es lo que recibió', () => {
    it('el total vendido, cuántas ventas y el ticket promedio', () => {
      const f = abrir();
      responder(f, conVentas());
      const texto = html(f).textContent!;
      expect(texto).toContain('1,250.50');
      expect(texto).toContain('11 ventas');
      expect(texto).toContain('ticket promedio');
      expect(texto).toContain('113.68');
    });

    it('una sola venta va en singular', () => {
      const f = abrir();
      const s = conVentas();
      s.total_orders = 1;
      responder(f, s);
      expect(html(f).textContent).toContain('1 venta ');
      expect(html(f).textContent).not.toContain('1 ventas');
    });

    it('la línea es exactamente la de los importes de cada día', () => {
      const f = abrir();
      responder(f, conVentas());
      expect(trazo(f)).toBe(linePath([0, 120, 0, 340.5, 0, 250, 540], 280, 100));
    });

    it('las etiquetas son los días del negocio y el último dice "Hoy"', () => {
      const f = abrir();
      responder(f, conVentas());
      const etiquetas = Array.from(html(f).querySelectorAll('.chart-labels span')).map(e => e.textContent);
      expect(etiquetas).toEqual(['Mié', 'Jue', 'Vie', 'Sáb', 'Dom', 'Lun', 'Hoy']);
    });

    it('la gráfica NO cambia al volver a entrar (ya no es aleatoria)', () => {
      const primera = abrir();
      responder(primera, conVentas());
      const antes = trazo(primera);

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
      http = TestBed.inject(HttpTestingController);
      TestBed.inject(ProductStore).products.set([]);
      const segunda = abrir();
      responder(segunda, conVentas());

      expect(trazo(segunda)).toBe(antes);
    });

    it('el trazo de la gráfica de ventas ya no es el del resumen de inventario (esa tarjeta ya no lleva una línea inventada)', () => {
      const f = abrir();
      responder(f, conVentas());
      expect(html(f).querySelector('svg.sparkline')).toBeNull();
      expect(html(f).querySelectorAll('svg.chart').length).toBe(1);
    });
  });

  describe('lo más vendido', () => {
    it('lista los productos con sus unidades', () => {
      const f = abrir();
      responder(f, conVentas());
      const filas = Array.from(html(f).querySelectorAll('.top-row')).map(r => r.textContent!.replace(/\s+/g, ' ').trim());
      expect(filas[0]).toContain('Café de Olla');
      expect(filas[0]).toContain('9 unidades');
      expect(filas[2]).toContain('1 unidad');
      expect(filas[2]).not.toContain('1 unidades');
    });

    it('el más vendido tiene la barra completa y los demás, su proporción', () => {
      const f = abrir();
      responder(f, conVentas());
      const anchos = Array.from(html(f).querySelectorAll<HTMLElement>('.top-bar i')).map(b => b.style.width);
      expect(anchos).toEqual(['100%', '44%', '11%']);
    });

    it('ya no existe la tendencia de stock inventada', () => {
      const f = abrir();
      responder(f, conVentas());
      expect(html(f).textContent).not.toContain('Tendencia de Stock');
      expect(html(f).textContent).not.toContain('Promedio');
    });
  });

  describe('sin ventas', () => {
    it('la gráfica es una línea plana en el piso y lo dice', () => {
      const f = abrir();
      responder(f, sinVentas());
      expect(trazo(f)).toBe(linePath([0, 0, 0, 0, 0, 0, 0], 280, 100));
      expect(html(f).textContent).toContain('Todavía no hay ventas cobradas en estos 7 días');
    });

    it('no hay ticket promedio inventado', () => {
      const f = abrir();
      responder(f, sinVentas());
      expect(html(f).textContent).not.toContain('ticket promedio');
      expect(html(f).textContent).toContain('0 ventas');
    });

    it('lo más vendido explica que aparecerá cuando haya ventas', () => {
      const f = abrir();
      responder(f, sinVentas());
      expect(html(f).textContent).toContain('Cuando haya ventas');
      expect(html(f).querySelectorAll('.top-row').length).toBe(0);
    });
  });

  describe('mientras carga y si falla', () => {
    it('mientras llegan dice que está cargando, no muestra una gráfica', () => {
      const f = abrir();
      expect(html(f).textContent).toContain('Cargando ventas');
      expect(html(f).querySelector('svg.chart')).toBeNull();
      http.expectOne(esStats).flush(sinVentas());
    });

    it('si falla, lo dice y deja reintentar', () => {
      const f = abrir();
      http.expectOne(esStats).flush({}, { status: 500, statusText: 'Server Error' });
      f.detectChanges();
      expect(html(f).textContent).toContain('No se pudieron cargar las ventas');
      expect(html(f).querySelector('svg.chart')).toBeNull();

      (html(f).querySelector('.link-btn') as HTMLButtonElement).click();
      responder(f, conVentas());
      expect(html(f).textContent).toContain('1,250.50');
      expect(html(f).textContent).not.toContain('No se pudieron cargar las ventas');
    });
  });
});
