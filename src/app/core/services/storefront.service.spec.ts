/**
 * Prueba del cliente PC-04 — caché en memoria de StorefrontService.
 *
 * Verifica que el catálogo y el negocio no se pidan de nuevo mientras sigan
 * vigentes, y —igual de importante— que la caché no sirva datos que no debe:
 * otra búsqueda, otro negocio, un dato vencido o una petición que falló.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { StorefrontService } from './storefront.service';

describe('PC-04 · StorefrontService (caché)', () => {
  let service: StorefrontService;
  let httpMock: HttpTestingController;

  const catalogo = { items: [], total: 0, page: 1, page_size: 100 };
  const productos = (url: string) => url.endsWith('/s/sabor/products');

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(StorefrontService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    vi.useRealTimers();
  });

  it('repetir la misma consulta no vuelve a la red', () => {
    service.getProducts('sabor', { pageSize: 100 }).subscribe();
    httpMock.expectOne(r => productos(r.url)).flush(catalogo);

    let recibido: unknown;
    service.getProducts('sabor', { pageSize: 100 }).subscribe(r => (recibido = r));

    httpMock.expectNone(r => productos(r.url));   // ninguna petición nueva
    expect(recibido).toEqual(catalogo);
  });

  it('dos peticiones simultáneas viajan como una sola', () => {
    service.getStore('sabor').subscribe();
    service.getStore('sabor').subscribe();

    const reqs = httpMock.match(r => r.url.endsWith('/s/sabor'));
    expect(reqs.length).toBe(1);
    reqs[0].flush({ slug: 'sabor' });
  });

  it('otra búsqueda sí va al servidor', () => {
    service.getProducts('sabor', { search: 'taco' }).subscribe();
    httpMock.expectOne(r => productos(r.url) && r.params.get('search') === 'taco').flush(catalogo);

    service.getProducts('sabor', { search: 'flan' }).subscribe();
    httpMock.expectOne(r => productos(r.url) && r.params.get('search') === 'flan').flush(catalogo);
  });

  it('no mezcla el catálogo de un negocio con el de otro', () => {
    service.getProducts('sabor').subscribe();
    httpMock.expectOne(r => productos(r.url)).flush(catalogo);

    service.getProducts('otro-negocio').subscribe();
    httpMock.expectOne(r => r.url.endsWith('/s/otro-negocio/products')).flush(catalogo);
  });

  it('pasado el minuto vuelve a pedirlo', () => {
    vi.useFakeTimers();
    service.getStore('sabor').subscribe();
    httpMock.expectOne(r => r.url.endsWith('/s/sabor')).flush({ slug: 'sabor' });

    vi.advanceTimersByTime(61_000);

    service.getStore('sabor').subscribe();
    httpMock.expectOne(r => r.url.endsWith('/s/sabor')).flush({ slug: 'sabor' });
  });

  it('un error no se queda guardado: el reintento sí viaja', () => {
    service.getStore('sabor').subscribe({ error: () => undefined });
    httpMock.expectOne(r => r.url.endsWith('/s/sabor')).flush('boom', { status: 500, statusText: 'Error' });

    service.getStore('sabor').subscribe();
    httpMock.expectOne(r => r.url.endsWith('/s/sabor')).flush({ slug: 'sabor' });
  });

  it('clearCache() obliga a pedir de nuevo', () => {
    service.getStore('sabor').subscribe();
    httpMock.expectOne(r => r.url.endsWith('/s/sabor')).flush({ slug: 'sabor' });

    service.clearCache();

    service.getStore('sabor').subscribe();
    httpMock.expectOne(r => r.url.endsWith('/s/sabor')).flush({ slug: 'sabor' });
  });
});
