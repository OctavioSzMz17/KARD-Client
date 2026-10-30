import {
  Component, DestroyRef, ElementRef, HostListener, computed, effect, inject,
  OnDestroy, OnInit, signal, viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { StorefrontProduct, StorefrontService } from '../../../core/services/storefront.service';
import { ProductImage } from '../../../core/services/image.service';
import { StorefrontStore } from '../../../core/store/storefront.store';

// El hub muestra el menú completo agrupado, así que se pide de una vez en
// lugar de paginar: una carta de restaurante rara vez pasa de esto, y
// paginar dejaría categorías incompletas al agrupar.
const PAGE_SIZE = 24;
// 100 es el máximo que acepta el endpoint público (page_size le=100).
const PAGE_SIZE_MENU = 100;

/** Una categoría del hub, con su lugar en la cuadrícula. */
interface Categoria {
  key: string;
  nombre: string;
  color: string;
  /** El quinto va al centro, como círculo flotante. */
  centro?: boolean;
}

@Component({
  selector: 'app-storefront-catalog',
  imports: [NgTemplateOutlet],
  templateUrl: './storefront-catalog.component.html',
  styleUrl: './storefront-catalog.component.scss'
})
export class StorefrontCatalogComponent implements OnInit, OnDestroy {
  readonly sf = inject(StorefrontStore);
  private svc        = inject(StorefrontService);
  private destroyRef = inject(DestroyRef);

  products        = signal<StorefrontProduct[]>([]);
  total           = signal(0);
  loadingProducts = signal(true);
  loadingMore     = signal(false);
  searchQuery     = signal('');
  /** Categoría elegida en la portada; nada se lista hasta que haya una. */
  categoriaActiva = signal<string | null>(null);
  private page    = 1;

  private search$ = new Subject<string>();

  // Referencia al hub para saber cuándo salió de pantalla y sacar el
  // botón flotante de bebidas.
  private hubRef = viewChild<ElementRef<HTMLElement>>('hub');
  private observer?: IntersectionObserver;
  private scrollFrame = 0;
  hubFuera = signal(false);

  /**
   * Los colores coinciden con los de las imágenes de respaldo del catálogo,
   * para que la categoría se reconozca igual en el hub que en la tarjeta.
   */
  readonly categorias: Categoria[] = [
    { key: 'entrada',      nombre: 'Entradas',       color: '#15803d' },
    { key: 'plato_fuerte', nombre: 'Platos fuertes', color: '#b91c1c' },
    { key: 'guarnicion',   nombre: 'Guarniciones',   color: '#a16207' },
    { key: 'postre',       nombre: 'Postres',        color: '#be185d' },
    { key: 'bebida',       nombre: 'Bebidas',        color: '#0e7490', centro: true },
  ];

  constructor() {
    // El hub no existe al construir el componente: aparece cuando llegan los
    // productos. Un efecto lo observa en cuanto el elemento está en el DOM,
    // que es lo que `ngAfterViewInit` no alcanzaba a ver.
    effect(() => {
      const el = this.hubRef()?.nativeElement;
      this.observer?.disconnect();
      if (!el) { this.hubFuera.set(false); return; }

      // El 35 % superior de la pantalla no cuenta: al elegir una categoría la
      // página se detiene con una franja del hub todavía asomando bajo la
      // barra, y con `rootMargin: 0` eso bastaba para tenerlo por "visible" y
      // el botón no salía hasta bajar casi al footer.
      this.observer = new IntersectionObserver(
        ([entry]) => this.hubFuera.set(!entry.isIntersecting),
        { threshold: 0, rootMargin: '-35% 0px 0px 0px' },
      );
      this.observer.observe(el);
    });
  }

  hasMore = computed(() => this.products().length < this.total());

  /** Imagen de fondo del encabezado: la del negocio, si la configuró. */
  readonly fondo = computed(() => this.sf.store()?.banner_url ?? null);

  /**
   * La portada alta se reserva desde el tipo de negocio, antes de que
   * lleguen los productos: de otro modo daría un salto al cargar.
   */
  readonly portadaAmplia = computed(() =>
    this.sf.store()?.business_type === 'restaurant' && !this.searchQuery()
  );

  /**
   * El hub solo tiene sentido en un menú por categorías.
   *
   * Una óptica no las usa —sus productos se describen por graduación— y
   * durante una búsqueda estorba: el cliente ya dijo qué quiere ver.
   */
  readonly modoHub = computed(() =>
    this.portadaAmplia() && this.products().some(p => !!p.metadata?.['categoria'])
  );

  /** Productos agrupados, respetando el orden de `categorias`. */
  readonly porCategoria = computed(() => {
    const items = this.products();
    return this.categorias
      .map(c => ({
        ...c,
        productos: items.filter(p => p.metadata?.['categoria'] === c.key),
      }))
      .filter(g => g.productos.length > 0);
  });

  /** La única categoría que se lista: la que el cliente eligió arriba. */
  readonly grupoActivo = computed(() => {
    const key = this.categoriaActiva();
    return key ? this.porCategoria().find(g => g.key === key) ?? null : null;
  });

  cuantosEn(key: string): number {
    return this.products().filter(p => p.metadata?.['categoria'] === key).length;
  }

  readonly categoriaCentral = computed(() => this.categorias.find(c => c.centro)!);

  /** Mini menú de bebidas del botón flotante. */
  bebidasAbiertas = signal(false);

  readonly bebidas = computed(() =>
    this.products().filter(p => p.metadata?.['categoria'] === this.categoriaCentral().key)
  );

  /**
   * El botón sale cuando el hub quedó atrás. Si la categoría abierta ya es
   * Bebidas no hace falta: están a la vista.
   */
  readonly mostrarFlotante = computed(() =>
    this.modoHub() && this.hubFuera()
    && this.categoriaActiva() !== this.categoriaCentral().key
    && this.bebidas().length > 0
  );
  readonly categoriasCuadrante = computed(() => this.categorias.filter(c => !c.centro));

  ngOnInit(): void {
    this.search$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(q => {
      this.searchQuery.set(q);
      // Buscar sustituye a la categoría: los resultados cruzan el menú entero.
      this.categoriaActiva.set(null);
      this.fetch(true);
    });

    this.fetch(true);
  }

  ngOnDestroy(): void {
    this.observer?.disconnect();
    cancelAnimationFrame(this.scrollFrame);
  }

  onSearch(e: Event): void {
    this.search$.next((e.target as HTMLInputElement).value.trim());
  }

  /** Deja abajo solo esa categoría y baja a ella. */
  elegir(key: string): void {
    this.bebidasAbiertas.set(false);
    this.categoriaActiva.set(key);
    // La sección se pinta al aplicarse la señal; se baja en el turno siguiente.
    setTimeout(() => this.desplazarA('productos'));
  }

  volverAlHub(): void {
    this.bebidasAbiertas.set(false);
    this.desplazarA('portada');
  }

  @HostListener('document:keydown.escape')
  cerrarBebidas(): void { this.bebidasAbiertas.set(false); }

  /**
   * Baja (o sube) animando el scroll.
   *
   * Se anima a mano y no con `scrollIntoView({ behavior: 'smooth' })`: ese
   * modo se apaga solo si el sistema tiene las animaciones reducidas, y deja
   * el salto seco que se quiere evitar. El destino se recalcula en cada
   * cuadro porque la categoría recién elegida cambia la altura de la página
   * mientras se desplaza.
   */
  private desplazarA(id: string): void {
    const destino = document.getElementById(id);
    if (!destino) return;

    cancelAnimationFrame(this.scrollFrame);
    const inicio = window.scrollY;
    const duracion = 800;
    const margen = parseFloat(getComputedStyle(destino).scrollMarginTop) || 0;
    const t0 = performance.now();

    const detener = () => cancelAnimationFrame(this.scrollFrame);
    // Si la persona toma el control con la rueda o el dedo, se le cede.
    window.addEventListener('wheel', detener, { once: true, passive: true });
    window.addEventListener('touchstart', detener, { once: true, passive: true });

    const paso = (ahora: number) => {
      const t = Math.min(1, (ahora - t0) / duracion);
      const suave = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;  // easeInOutCubic
      const fin = destino.getBoundingClientRect().top + window.scrollY - margen;
      window.scrollTo(0, inicio + (fin - inicio) * suave);
      if (t < 1) this.scrollFrame = requestAnimationFrame(paso);
      else {
        window.removeEventListener('wheel', detener);
        window.removeEventListener('touchstart', detener);
      }
    };
    this.scrollFrame = requestAnimationFrame(paso);
  }

  loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;
    this.page += 1;
    this.loadingMore.set(true);
    this.svc.getProducts(this.sf.slug, { search: this.searchQuery() || undefined, page: this.page, pageSize: PAGE_SIZE })
      .subscribe({
        next: (res) => {
          this.products.update(items => [...items, ...res.items]);
          this.total.set(res.total);
          this.loadingMore.set(false);
        },
        error: () => this.loadingMore.set(false)
      });
  }

  private fetch(reset: boolean): void {
    if (reset) { this.page = 1; this.loadingProducts.set(true); }
    // Sin búsqueda se trae el menú completo para poder agruparlo; al buscar
    // se vuelve a la lista paginada de siempre.
    const pageSize = this.searchQuery() ? PAGE_SIZE : PAGE_SIZE_MENU;
    this.svc.getProducts(this.sf.slug, { search: this.searchQuery() || undefined, page: this.page, pageSize })
      .subscribe({
        next: (res) => { this.products.set(res.items); this.total.set(res.total); this.loadingProducts.set(false); },
        error: () => { this.products.set([]); this.total.set(0); this.loadingProducts.set(false); }
      });
  }

  // ── Helpers de presentación ───────────────────────────
  primaryImage(images: ProductImage[]): ProductImage | null {
    return images?.find(i => i.sort_order === 0) ?? images?.[0] ?? null;
  }

  /** Chips de metadata según el tipo de negocio. */
  metaChips(p: StorefrontProduct): string[] {
    const m = p.metadata ?? {};
    const type = this.sf.store()?.business_type;

    if (type === 'restaurant') {
      const chips: string[] = [];
      if (m['tiempo_preparacion_min']) chips.push(`${m['tiempo_preparacion_min']} min`);
      if (m['picante'])                chips.push('🌶 picante');
      return chips;
    }
    if (type === 'optician') {
      const chips: string[] = [];
      if (m['material']) chips.push(m['material']);
      if (m['esfera'] !== undefined && m['cilindro'] !== undefined) chips.push(`${m['esfera']} / ${m['cilindro']}`);
      return chips;
    }
    return [];
  }
}
