import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { CategoryItem, ExploreService, ExploreStore } from '../../core/services/explore.service';

const CATEGORY_LABELS: Record<string, string> = {
  restaurant: 'Restaurantes',
  optician:   'Ópticas',
};

// Descripción por defecto mientras el backend no envíe `description`
const TYPE_TAGLINES: Record<string, string> = {
  restaurant: 'Platillos preparados al momento para ti.',
  optician:   'Lentes, armazones y salud visual.',
};

@Component({
  selector: 'app-explore',
  templateUrl: './explore.component.html',
  styleUrl: './explore.component.scss'
})
export class ExploreComponent implements OnInit {
  private auth       = inject(AuthService);
  private explore    = inject(ExploreService);
  private router     = inject(Router);
  private destroyRef = inject(DestroyRef);

  categories       = signal<CategoryItem[]>([]);
  stores           = signal<ExploreStore[]>([]);
  loadingStores    = signal(true);
  loadError        = signal(false);
  activeCategory   = signal<string | null>(null);
  searchQuery      = signal('');

  private search$ = new Subject<string>();

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

  private fetchStores(): void {
    this.loadingStores.set(true);
    this.loadError.set(false);
    this.explore.getStores({
      category: this.activeCategory() ?? undefined,
      search:   this.searchQuery() || undefined
    }).subscribe({
      next: (res) => {
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

  categoryLabel(type: string): string {
    return CATEGORY_LABELS[type] ?? type;
  }

  storeDescription(s: ExploreStore): string {
    return s.description || TYPE_TAGLINES[s.business_type] || 'Tienda en KARD.';
  }

  openStore(s: ExploreStore): void {
    this.router.navigate(['/s', s.slug]);
  }

  logout(): void {
    this.auth.logout();
  }
}
