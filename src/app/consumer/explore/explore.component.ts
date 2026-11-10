import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { CategoryItem, ExploreService, ExploreStore } from '../../core/services/explore.service';
import { BUBBLES } from '../../shared/brand-images';
import { BRAND_NAME } from '../../shared/brand';

const CATEGORY_LABELS: Record<string, string> = {
  restaurant: 'Restaurantes',
  optician:   'Ópticas',
};

// Descripción por defecto mientras el backend no envíe `description`
const TYPE_TAGLINES: Record<string, string> = {
  restaurant: 'Platillos preparados al momento para ti.',
  optician:   'Lentes, armazones y salud visual.',
};

/**
 * Cuánto tarda en armarse la parte de arriba (encabezado, título, búsqueda,
 * categorías). Las tarjetas de la primera carga esperan a que termine para
 * caer encima, como las capas de una hamburguesa.
 */
const INTRO_SECONDS = 1.55;

@Component({
  selector: 'app-explore',
  imports: [RouterLink, NgTemplateOutlet],
  templateUrl: './explore.component.html',
  styleUrl: './explore.component.scss'
})
export class ExploreComponent implements OnInit {
  /** Nombre del producto en pantalla (ver shared/brand.ts). */
  readonly brand = BRAND_NAME;
  private auth       = inject(AuthService);
  private explore    = inject(ExploreService);
  private destroyRef = inject(DestroyRef);

  categories       = signal<CategoryItem[]>([]);
  stores           = signal<ExploreStore[]>([]);
  loadingStores    = signal(true);
  loadError        = signal(false);
  activeCategory   = signal<string | null>(null);
  searchQuery      = signal('');

  /**
   * Segundos que esperan las tarjetas antes de caer. En la primera carga
   * esperan lo que falte de la entrada; después, casi nada: filtrar o buscar
   * debe sentirse inmediato.
   */
  baseDelay = signal(INTRO_SECONDS);

  /** El título se arma palabra por palabra: cada una cae por separado. */
  readonly palabras = ['¿Qué', 'tienes', 'en', 'mente?'];

  /** Burbujas decorativas del encabezado: las mismas fotos que en el acceso. */
  readonly heroBubbles = [
    { slot: 'a', size: 124, label: 'Restaurantes', bg: `url(${BUBBLES[0].img})` },
    { slot: 'b', size: 84,  label: '',             bg: `url(${BUBBLES[1].img})` },
    { slot: 'c', size: 110, label: 'Ópticas',      bg: `url(${BUBBLES[5].img})` },
    { slot: 'd', size: 72,  label: '',             bg: `url(${BUBBLES[3].img})` },
  ];

  private search$ = new Subject<string>();
  private born = performance.now();
  private calmMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  ngOnInit(): void {
    this.search$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(q => {
      this.searchQuery.set(q);
      this.fetchStores();
    });

    this.explore.getCategories().subscribe({
      next: (res) => this.categories.set(res.categories),
      error: () => this.categories.set([])
    });

    this.fetchStores();
  }

  onSearch(e: Event): void {
    this.search$.next((e.target as HTMLInputElement).value.trim());
  }

  selectCategory(type: string): void {
    this.activeCategory.set(this.activeCategory() === type ? null : type);
    this.fetchStores();
  }

  /** "Todos": quita el filtro de categoría. */
  clearCategory(): void {
    if (this.activeCategory() === null) return;
    this.activeCategory.set(null);
    this.fetchStores();
  }

  totalStores(): number {
    return this.categories().reduce((sum, c) => sum + c.store_count, 0);
  }

  private fetchStores(): void {
    this.loadingStores.set(true);
    this.loadError.set(false);
    this.explore.getStores({
      category: this.activeCategory() ?? undefined,
      search:   this.searchQuery() || undefined
    }).subscribe({
      next: (res) => {
        // Se calcula antes de pintar las tarjetas: las de la primera carga
        // esperan lo que falte de la entrada; las siguientes, casi nada.
        const transcurrido = (performance.now() - this.born) / 1000;
        this.baseDelay.set(Math.max(0.05, INTRO_SECONDS - transcurrido));
        this.stores.set(res.items);
        this.loadingStores.set(false);
      },
      error: () => {
        this.stores.set([]);
        this.loadingStores.set(false);
        this.loadError.set(true);
      }
    });
  }

  // ── Inclinación de las tarjetas ───────────────────────────
  // La tarjeta se inclina hacia el cursor y una luz la sigue. Solo escribe
  // variables CSS; quien pidió menos movimiento (o toca con el dedo) no la ve.
  onTilt(event: PointerEvent): void {
    if (this.calmMotion || event.pointerType === 'touch') return;
    const card = event.currentTarget as HTMLElement;
    const r = card.getBoundingClientRect();
    const x = (event.clientX - r.left) / r.width;
    const y = (event.clientY - r.top) / r.height;
    card.style.setProperty('--rx', `${((0.5 - y) * 9).toFixed(2)}deg`);
    card.style.setProperty('--ry', `${((x - 0.5) * 11).toFixed(2)}deg`);
    card.style.setProperty('--px', `${(x * 100).toFixed(1)}%`);
    card.style.setProperty('--py', `${(y * 100).toFixed(1)}%`);
  }

  resetTilt(event: PointerEvent): void {
    const card = event.currentTarget as HTMLElement;
    for (const v of ['--rx', '--ry', '--px', '--py']) card.style.removeProperty(v);
  }

  categoryLabel(type: string): string {
    return CATEGORY_LABELS[type] ?? type;
  }

  storeDescription(s: ExploreStore): string {
    return s.tagline || TYPE_TAGLINES[s.business_type] || `Tienda en ${BRAND_NAME}.`;
  }

  initial(s: ExploreStore): string {
    return s.business_name.trim().charAt(0).toUpperCase();
  }

  logout(): void {
    this.auth.logout();
  }
}
