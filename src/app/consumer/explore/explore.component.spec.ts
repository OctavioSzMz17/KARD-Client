/**
 * Prueba del cliente PC-05 — ExploreComponent (catálogo de negocios)
 * (ver docs/Pruebas_IEEE829.md en el repositorio del backend)
 *
 * Lo que se verifica es lo que el cliente usa para llegar a una tienda:
 *   - cada negocio es un enlace real a su tienda (teclado y pestaña nueva);
 *   - filtrar por categoría y "Todos" piden lo correcto al servidor;
 *   - la búsqueda espera a que se deje de escribir;
 *   - un negocio sin banner o sin logo igual se muestra completo;
 *   - la inclinación de las tarjetas respeta "reducir movimiento".
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { ExploreComponent } from './explore.component';

describe('PC-05 · ExploreComponent', () => {
  const API = 'http://localhost:8000/api/v1';

  let httpMock: HttpTestingController;

  const stores = {
    items: [
      { slug: 'sabor', business_name: 'Sabor Norteño', business_type: 'restaurant',
        logo_url: 'https://x/logo.png', banner_url: 'https://x/banner.jpg', tagline: 'Cocina de leña' },
      { slug: 'buena-vista', business_name: 'Buena vista', business_type: 'optician',
        logo_url: null, banner_url: null, tagline: null },
    ],
    total: 2, page: 1, page_size: 20,
  };
  const categorias = { categories: [
    { business_type: 'restaurant', store_count: 1 },
    { business_type: 'optician', store_count: 1 },
  ] };

  /** Crea el componente y contesta las dos peticiones con las que arranca. */
  function crear(reducirMovimiento = false) {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: reducirMovimiento && q.includes('reduce'), media: q,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));

    TestBed.configureTestingModule({
      imports: [ExploreComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    httpMock = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(ExploreComponent);
    fixture.detectChanges();
    httpMock.expectOne(`${API}/explore/categories`).flush(categorias);
    httpMock.expectOne(r => r.url === `${API}/explore`).flush(stores);
    fixture.detectChanges();
    return fixture;
  }

  const el = (f: ReturnType<typeof crear>) => f.nativeElement as HTMLElement;

  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('cada negocio es un enlace real a su tienda', () => {
    const f = crear();

    const enlaces = Array.from(el(f).querySelectorAll<HTMLAnchorElement>('a.store-card'));

    expect(enlaces.map(a => a.getAttribute('href'))).toEqual(['/s/sabor', '/s/buena-vista']);
  });

  it('un negocio con banner lo usa de portada; sin banner cae al ícono de su giro', () => {
    const f = crear();
    const [conBanner, sinBanner] = Array.from(el(f).querySelectorAll('a.store-card'));

    expect(conBanner.querySelector('.cover-img')?.getAttribute('src')).toBe('https://x/banner.jpg');
    expect(sinBanner.querySelector('.cover-img')).toBeNull();
    expect(sinBanner.querySelector('.cover-icon svg')).not.toBeNull();
  });

  it('un negocio sin logo muestra su inicial en vez de quedar vacío', () => {
    const f = crear();
    const sinLogo = el(f).querySelectorAll('a.store-card')[1];

    expect(sinLogo.querySelector('.logo-pin img')).toBeNull();
    expect(sinLogo.querySelector('.logo-pin b')?.textContent).toBe('B');
  });

  it('un negocio sin eslogan usa el texto de su giro', () => {
    const f = crear();

    expect(el(f).querySelectorAll('.store-desc')[1].textContent).toContain('armazones');
  });

  it('"Todos" arranca activo con el total de negocios', () => {
    const f = crear();
    const activo = el(f).querySelector('.chip.active');

    expect(activo?.textContent).toContain('Todos');
    expect(activo?.textContent).toContain('2');
  });

  it('elegir una categoría pide solo esa; "Todos" vuelve a la lista sin pedirla otra vez', () => {
    const f = crear();
    const chips = Array.from(el(f).querySelectorAll<HTMLButtonElement>('.chip'));

    chips.find(c => c.textContent?.includes('Restaurantes'))!.click();
    const filtrada = httpMock.expectOne(r => r.url === `${API}/explore`);
    expect(filtrada.request.params.get('category')).toBe('restaurant');
    filtrada.flush({ ...stores, items: [stores.items[0]], total: 1 });
    f.detectChanges();
    expect(el(f).querySelectorAll('a.store-card').length).toBe(1);

    // La lista completa ya se pidió al abrir la pantalla: se reutiliza.
    chips.find(c => c.textContent?.includes('Todos'))!.click();
    httpMock.expectNone(r => r.url === `${API}/explore`);
    f.detectChanges();
    expect(el(f).querySelectorAll('a.store-card').length).toBe(2);
  });

  it('la búsqueda espera a que se deje de escribir', () => {
    const f = crear();
    const input = el(f).querySelector<HTMLInputElement>('.search-bar input')!;

    input.value = 'sab';
    input.dispatchEvent(new Event('input'));
    input.value = 'sabor';
    input.dispatchEvent(new Event('input'));
    httpMock.expectNone(r => r.url === `${API}/explore`);   // aún no pasaron los 300 ms

    vi.advanceTimersByTime(300);

    const req = httpMock.expectOne(r => r.url === `${API}/explore`);
    expect(req.request.params.get('search')).toBe('sabor');   // una sola petición, con lo último
    req.flush({ ...stores, items: [], total: 0 });
    f.detectChanges();
    expect(el(f).querySelector('.empty-title')?.textContent).toBe('Sin resultados');
  });

  it('si falla la carga se avisa, no se deja vacío', () => {
    const f = crear();
    const chips = Array.from(el(f).querySelectorAll<HTMLButtonElement>('.chip'));

    chips.find(c => c.textContent?.includes('Ópticas'))!.click();
    httpMock.expectOne(r => r.url === `${API}/explore`).flush('x', { status: 500, statusText: 'Error' });
    f.detectChanges();

    expect(el(f).querySelector('.empty-title')?.textContent).toContain('No pudimos cargar');
  });

  describe('inclinación de las tarjetas', () => {
    const mover = (card: HTMLElement) =>
      card.dispatchEvent(new PointerEvent('pointermove', { clientX: 10, clientY: 10, pointerType: 'mouse', bubbles: true }));

    it('con movimiento normal la tarjeta se inclina hacia el cursor', () => {
      const f = crear(false);
      const card = el(f).querySelector<HTMLElement>('a.store-card')!;

      mover(card);

      expect(card.style.getPropertyValue('--ry')).toMatch(/deg$/);
      expect(card.style.getPropertyValue('--px')).toMatch(/%$/);
    });

    it('al salir el cursor la tarjeta se endereza', () => {
      const f = crear(false);
      const card = el(f).querySelector<HTMLElement>('a.store-card')!;
      mover(card);

      card.dispatchEvent(new PointerEvent('pointerleave'));

      expect(card.style.getPropertyValue('--ry')).toBe('');
    });

    it('con "reducir movimiento" no se inclina', () => {
      const f = crear(true);
      const card = el(f).querySelector<HTMLElement>('a.store-card')!;

      mover(card);

      expect(card.style.getPropertyValue('--ry')).toBe('');
    });
  });
});
