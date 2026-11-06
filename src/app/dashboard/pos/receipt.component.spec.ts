/**
 * Prueba del cliente PC-20 — Quién cobró y desde qué caja (ticket, ventas y corte)
 *
 * El ticket que se le da al cliente dice "Caja: Caja 1" y "Atendió: Eva P." (nombre e inicial,
 * no el correo ni el nombre completo). Las vistas internas dicen el nombre completo y el código:
 * el reporte de ventas y el corte de caja, en pantalla y en la hoja impresa.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { ReceiptComponent } from './receipt.component';
import { SalesComponent } from '../sales/sales.component';
import { CashComponent } from '../cash/cash.component';
import { CutSheetComponent } from '../cash/cut-sheet.component';
import { PosSale } from '../../core/services/sales.service';
import { CashSession } from '../../core/services/cash.service';
import { environment } from '../../../environments/environment';

const API = environment.apiUrl;

const venta = (extra: Partial<PosSale> = {}): PosSale => ({
  order_id: 'ord_4b3b8aa4cafe', status: 'paid', fulfillment_type: 'takeaway', payment_method: 'card',
  subtotal: '164.00', shipping_cost: '0.00', discount_amount: '0.00', tip_amount: '0.00', total: '164.00',
  amount_received: null, change_given: null, table_number: null, customer_name: null,
  cashier: 'Eva P.', register_name: 'Caja 1',
  items: [{ product_id: 'p_1', product_name: 'Café de Olla', quantity: 2, unit_price: '38.00', subtotal: '76.00' }] as any,
  created_at: '2026-11-04T17:38:00Z', business_name: 'Sabor Norteño', ...extra,
});

function ticket(sale: PosSale) {
  const fixture = TestBed.createComponent(ReceiptComponent);
  fixture.componentRef.setInput('sale', sale);
  fixture.detectChanges();
  return (fixture.nativeElement as HTMLElement).querySelector('.r-meta')!.textContent!.replace(/\s+/g, ' ').trim();
}

describe('PC-20 · Quién cobró y desde qué caja', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
  });

  afterEach(() => localStorage.clear());

  describe('el ticket del cliente', () => {
    it('dice la caja y quién atendió, con nombre e inicial', () => {
      const meta = ticket(venta());
      expect(meta).toContain('Caja: Caja 1');
      expect(meta).toContain('Atendió: Eva P.');
    });

    it('la caja va antes que quién atendió', () => {
      const meta = ticket(venta());
      expect(meta.indexOf('Caja: Caja 1')).toBeLessThan(meta.indexOf('Atendió: Eva P.'));
    });

    it('no entrega un correo ni el nombre completo', () => {
      const meta = ticket(venta());
      expect(meta).not.toContain('@');
      expect(meta).not.toContain('Prueba');
    });

    it('una venta sin caja (desde otro equipo) no inventa una', () => {
      const meta = ticket(venta({ register_name: null }));
      expect(meta).not.toContain('Caja:');
      expect(meta).toContain('Atendió: Eva P.');
    });

    it('una venta sin cajero no dice "Atendió"', () => {
      expect(ticket(venta({ cashier: null }))).not.toContain('Atendió');
    });

    it('el modo de entrega y el cliente siguen donde estaban', () => {
      const meta = ticket(venta({ customer_name: 'Doña Mari' }));
      expect(meta).toContain('Para llevar');
      expect(meta).toContain('Cliente: Doña Mari');
    });
  });

  describe('el reporte de ventas', () => {
    function reporte() {
      const http = TestBed.inject(HttpTestingController);
      const fixture = TestBed.createComponent(SalesComponent);
      fixture.detectChanges();
      http.match(r => r.url === `${API}/settings/branding`).forEach(r => r.flush({ logo_url: null }));
      http.expectOne(r => r.url === `${API}/orders/business/sales`).flush({
        business_name: 'Sabor Norteño', total: 2, page: 1, page_size: 20,
        summary: { order_count: 2, canceled_count: 0, revenue: '300.00', units: 3 },
        items: [
          {
            order_id: 'ord_a', status: 'paid', total: '164.00', item_count: 2, customer_name: 'Venta de mostrador',
            customer_email: null, items: [], created_at: '2026-11-04T17:38:00Z', payment_method: 'card',
            cashier_name: 'Eva Prueba', cashier_code: '0009', register_name: 'Caja 1',
          },
          {
            order_id: 'ord_b', status: 'pending', total: '136.00', item_count: 1, customer_name: 'Ana', customer_email: 'ana@correo.com',
            items: [], created_at: '2026-11-04T17:40:00Z', payment_method: null,
            cashier_name: null, cashier_code: null, register_name: null,
          },
        ],
      });
      fixture.detectChanges();
      return fixture;
    }

    it('tiene la columna Cajero', () => {
      const f = reporte();
      const columnas = Array.from((f.nativeElement as HTMLElement).querySelectorAll('thead th')).map(t => t.textContent!.trim());
      expect(columnas).toContain('Cajero');
      expect(columnas.indexOf('Cajero')).toBe(columnas.indexOf('Cliente') + 1);
    });

    it('muestra el nombre completo, el código y la caja', () => {
      const f = reporte();
      const celda = (f.nativeElement as HTMLElement).querySelectorAll('tbody tr')[0].querySelector('.cashier-cell')!.textContent!.replace(/\s+/g, ' ').trim();
      expect(celda).toContain('Eva Prueba');
      expect(celda).toContain('#0009');
      expect(celda).toContain('Caja 1');
    });

    it('un pedido en línea (sin cajero) muestra una raya, no "null"', () => {
      const f = reporte();
      const celda = (f.nativeElement as HTMLElement).querySelectorAll('tbody tr')[1].querySelector('.cashier-cell')!.textContent!.trim();
      expect(celda).toBe('—');
    });
  });

  describe('la descarga CSV del reporte', () => {
    const REPORTE = {
      business_name: 'Sabor Norteño', total: 2, page: 1, page_size: 100,
      summary: { order_count: 2, canceled_count: 0, revenue: '300.00', units: 3 },
      items: [
        {
          order_id: 'ord_a', status: 'paid', total: '164.00', item_count: 2, customer_name: 'Venta de mostrador', customer_email: null,
          items: [], created_at: '2026-11-04T17:38:00Z', payment_method: 'card',
          cashier_name: 'Eva Prueba', cashier_code: '0009', register_name: 'Caja 1',
        },
        {
          order_id: 'ord_b', status: 'pending', total: '136.00', item_count: 1, customer_name: 'Ana', customer_email: 'ana@correo.com',
          items: [], created_at: '2026-11-04T17:40:00Z', payment_method: null, cashier_name: null, cashier_code: null, register_name: null,
        },
      ],
    };

    async function descargar(): Promise<string[]> {
      const http = TestBed.inject(HttpTestingController);
      const fixture = TestBed.createComponent(SalesComponent);
      fixture.detectChanges();
      http.match(r => r.url === `${API}/settings/branding`).forEach(r => r.flush({ logo_url: null }));
      http.expectOne(r => r.url === `${API}/orders/business/sales`).flush(REPORTE);

      const comp = fixture.componentInstance as any;
      let archivo!: Blob;
      comp.triggerDownload = (blob: Blob) => { archivo = blob; };

      const terminado = comp.downloadCsv();
      http.expectOne(r => r.url === `${API}/orders/business/sales`).flush(REPORTE);
      await terminado;
      return (await archivo.text()).replace('\uFEFF', '').split('\r\n');
    }

    it('el encabezado trae Cajero y Caja, después del cliente', async () => {
      const [encabezado] = await descargar();
      expect(encabezado).toBe('"Folio","Fecha","Cliente","Correo","Cajero","Caja","Estado","Artículos","Total"');
    });

    it('cada venta dice quién cobró y desde qué caja', async () => {
      const filas = await descargar();
      expect(filas[1]).toContain('"Eva Prueba","Caja 1"');
    });

    it('un pedido en línea deja esas dos celdas vacías, sin "null"', async () => {
      const filas = await descargar();
      expect(filas[2]).toContain('"ana@correo.com","","",');
      expect(filas[2]).not.toContain('null');
    });

    it('las columnas de cada fila coinciden con las del encabezado', async () => {
      const filas = await descargar();
      const columnas = (fila: string) => fila.split('","').length;
      expect(columnas(filas[1])).toBe(columnas(filas[0]));
      expect(columnas(filas[2])).toBe(columnas(filas[0]));
    });
  });

  describe('el corte de caja', () => {
    const sesion = (porCajero?: any[]): CashSession => ({
      session_id: 'cs_1', status: 'closed', opened_at: '2026-11-04T14:00:00Z', opened_by: 'gina@example.com',
      opening_float: '300.00', closed_at: '2026-11-04T22:00:00Z', closed_by: 'gina@example.com',
      expected_cash: '600.00', counted_cash: '600.00', difference: '0.00', notes: null,
      summary: {
        sales_count: 4, gross: '420.00',
        cash: { count: 3, total: '300.00' }, card: { count: 1, total: '120.00' }, transfer: { count: 0, total: '0.00' }, other: { count: 0, total: '0.00' },
        discounts: '0.00', tips_total: '0.00', tips_cash: '0.00', excluded_count: 0,
        ...(porCajero ? { by_cashier: porCajero } : {}),
      },
    });

    const CAJEROS = [
      { user_id: 'u_1', name: 'Eva Prueba', code: '0009', count: 3, total: '300.00' },
      { user_id: 'u_2', name: 'Luis Ramos', code: '0010', count: 1, total: '120.00' },
    ];

    function hoja(s: CashSession) {
      const fixture = TestBed.createComponent(CutSheetComponent);
      fixture.componentRef.setInput('session', s);
      fixture.detectChanges();
      return (fixture.nativeElement as HTMLElement).textContent!.replace(/\s+/g, ' ');
    }

    it('la hoja impresa lista a cada cajero con sus ventas y su importe', () => {
      const texto = hoja(sesion(CAJEROS));
      expect(texto).toContain('Ventas por cajero');
      expect(texto).toContain('Eva Prueba');
      expect(texto).toContain('#0009');
      expect(texto).toContain('$300.00');
      expect(texto).toContain('Luis Ramos');
      expect(texto).toContain('$120.00');
    });

    it('un corte anterior, sin lista de cajeros, se lee igual y no muestra la sección', () => {
      const texto = hoja(sesion());
      expect(texto).not.toContain('Ventas por cajero');
      expect(texto).toContain('Corte de caja');
    });

    it('un turno sin ventas no muestra una tabla vacía', () => {
      expect(hoja(sesion([]))).not.toContain('Ventas por cajero');
    });

    it('la pantalla del turno abierto también lo muestra', () => {
      const http = TestBed.inject(HttpTestingController);
      const fixture = TestBed.createComponent(CashComponent);
      fixture.detectChanges();
      http.expectOne(`${API}/cash/current`).flush({ ...sesion(CAJEROS), status: 'open', closed_at: null, closed_by: null, counted_cash: null, difference: null });
      http.match(r => r.url === `${API}/cash/sessions`).forEach(r => r.flush({ items: [], total: 0, page: 1, page_size: 10 }));
      fixture.detectChanges();

      const tabla = (fixture.nativeElement as HTMLElement).querySelector('table.by-cashier')!;
      const filas = Array.from(tabla.querySelectorAll('tbody tr')).map(r => r.textContent!.replace(/\s+/g, ' ').trim());
      expect(filas[0]).toContain('Eva Prueba');
      expect(filas[0]).toContain('#0009');
      expect(filas[0]).toContain('$300.00');
      expect(filas[1]).toContain('Luis Ramos');
    });
  });
});
