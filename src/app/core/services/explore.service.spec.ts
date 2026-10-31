/**
 * Prueba del cliente PC-06 — caché en memoria de ExploreService.
 *
 * Al volver de una tienda a explorar, o al alternar entre categorías, no debe
 * pedirse otra vez lo que ya se tiene; pero la caché tampoco debe servir lo
 * que no corresponde: otra categoría, otra página, un dato vencido o una
 * petición que falló.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { ExploreService } from './explore.service';

describe('PC-06 · ExploreService (caché)', () => {
  const API = 'http://localhost:8000/api/v1';
  const listado = { items: [], total: 0, page: 1, page_size: 20 };

  let service: ExploreService;
  let httpMock: HttpTestingController;

  const lista = (r: { url: string }) => r.url === `${API}/explore`;
  const categorias = (r: { url: string }) => r.url === `${API}/explore/categories`;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(ExploreService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
  });

  it('las categorías no se piden dos veces', () => {
    service.getCategories().subscribe();
    httpMock.expectOne(categorias).flush({ categories: [] });

    let recibido: unknown;
    service.getCategories().subscribe(r => (recibido = r));

    httpMock.expectNone(categorias);
    expect(recibido).toEqual({ categories: [] });
  });

  it('el mismo listado no se vuelve a pedir', () => {
    service.getStores({ category: 'restaurant' }).subscribe();
    httpMock.expectOne(lista).flush(listado);

    service.getStores({ category: 'restaurant' }).subscribe();

    httpMock.expectNone(lista);
  });

  it('otra categoría, otra página o otra búsqueda sí van al servidor', () => {
    service.getStores({ category: 'restaurant' }).subscribe();
    httpMock.expectOne(lista).flush(listado);

    service.getStores({ category: 'optician' }).subscribe();
    httpMock.expectOne(r => lista(r) && r.params.get('category') === 'optician').flush(listado);

    service.getStores({ category: 'restaurant', page: 2 }).subscribe();
    httpMock.expectOne(r => lista(r) && r.params.get('page') === '2').flush(listado);

    service.getStores({ search: 'sab' }).subscribe();
    httpMock.expectOne(r => lista(r) && r.params.get('search') === 'sab').flush(listado);
  });

  it('sin filtros y con la categoría vacía son listados distintos', () => {
    service.getStores().subscribe();
    httpMock.expectOne(lista).flush(listado);

    service.getStores({ category: 'restaurant' }).subscribe();
    httpMock.expectOne(r => lista(r) && r.params.get('category') === 'restaurant').flush(listado);
  });

  it('dos peticiones simultáneas viajan como una sola', () => {
    service.getCategories().subscribe();
    service.getCategories().subscribe();

    const reqs = httpMock.match(categorias);
    expect(reqs.length).toBe(1);
    reqs[0].flush({ categories: [] });
  });

  it('pasado el minuto vuelve a pedirlo', () => {
    vi.useFakeTimers();
    service.getStores().subscribe();
    httpMock.expectOne(lista).flush(listado);

    vi.advanceTimersByTime(61_000);

    service.getStores().subscribe();
    httpMock.expectOne(lista).flush(listado);
  });

  it('un error no se queda guardado: el reintento sí viaja', () => {
    service.getStores().subscribe({ error: () => undefined });
    httpMock.expectOne(lista).flush('x', { status: 500, statusText: 'Error' });

    service.getStores().subscribe();
    httpMock.expectOne(lista).flush(listado);
  });

  it('clearCache() obliga a pedir de nuevo', () => {
    service.getCategories().subscribe();
    httpMock.expectOne(categorias).flush({ categories: [] });

    service.clearCache();

    service.getCategories().subscribe();
    httpMock.expectOne(categorias).flush({ categories: [] });
  });
});
