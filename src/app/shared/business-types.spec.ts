import { BUSINESS_TYPES, GENERAL_UNITS, businessTypeInfo, generalMetadata, isGeneralCommerce } from './business-types';

describe('Giros de negocio', () => {
  it('ofrece al menos cinco giros, entre ellos la tiendita', () => {
    expect(BUSINESS_TYPES.length).toBeGreaterThanOrEqual(5);
    expect(businessTypeInfo('grocery')?.label).toBe('Tiendita');
  });

  it('cada giro trae todo lo que las pantallas necesitan', () => {
    for (const t of BUSINESS_TYPES) {
      expect(t.label, t.key).toBeTruthy();
      expect(t.plural, t.key).toBeTruthy();
      expect(t.blurb, t.key).toBeTruthy();
      expect(t.summary, t.key).toBeTruthy();
      expect(t.tagline, t.key).toBeTruthy();
      expect(t.about, t.key).toBeTruthy();
      expect(t.storeName, t.key).toBeTruthy();
      expect(t.icon.length, t.key).toBeGreaterThan(0);
    }
  });

  it('no repite giros', () => {
    const keys = BUSINESS_TYPES.map(t => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('un giro desconocido o la plataforma no tiene ficha', () => {
    expect(businessTypeInfo('platform')).toBeUndefined();
    expect(businessTypeInfo(undefined)).toBeUndefined();
  });

  it('restaurante y óptica tienen su propia ficha; el resto es comercio general', () => {
    expect(isGeneralCommerce('restaurant')).toBe(false);
    expect(isGeneralCommerce('optician')).toBe(false);
    expect(isGeneralCommerce('platform')).toBe(false);
    for (const k of ['grocery', 'bakery', 'clothing', 'stationery', 'hardware']) {
      expect(isGeneralCommerce(k), k).toBe(true);
    }
  });

  describe('generalMetadata', () => {
    it('manda solo lo que se llenó (el servidor rechaza cadenas vacías)', () => {
      expect(generalMetadata({ unidad: 'pieza', marca: '  ', categoria_general: '' })).toEqual({ unidad: 'pieza' });
    });

    it('recorta espacios y conserva marca y categoría', () => {
      expect(generalMetadata({ unidad: 'kg', marca: ' Bimbo ', categoria_general: ' Pan ' }))
        .toEqual({ unidad: 'kg', marca: 'Bimbo', categoria: 'Pan' });
    });

    it('con todo vacío manda un objeto vacío, que es válido', () => {
      expect(generalMetadata({})).toEqual({});
    });

    it('las unidades coinciden con las que acepta el servidor', () => {
      expect([...GENERAL_UNITS]).toEqual(['pieza', 'kg', 'g', 'litro', 'ml', 'paquete', 'caja', 'docena']);
    });
  });
});
