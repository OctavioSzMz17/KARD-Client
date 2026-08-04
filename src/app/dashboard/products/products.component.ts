import { Component, inject, OnInit, signal, computed } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { AuthService, UserSession } from '../../core/services/auth.service';
import { SnackbarService } from '../../core/services/snackbar.service';
import { ImageService, ProductImage } from '../../core/services/image.service';
import { RecipeService, RecipeItem } from '../../core/services/recipe.service';
import { ProductStore, Product } from '../../core/store/product.store';

export type { Product };   // re-export so existing template references compile

@Component({
  selector: 'app-products',
  imports: [ReactiveFormsModule, FormsModule],
  templateUrl: './products.component.html',
  styleUrl: './products.component.scss'
})
export class ProductsComponent implements OnInit {
  private store     = inject(ProductStore);
  private auth      = inject(AuthService);
  private fb        = inject(FormBuilder);
  private snack     = inject(SnackbarService);
  private imgSvc    = inject(ImageService);
  private recipeSvc = inject(RecipeService);

  session: UserSession | null = null;

  // ── Products state (from store — survive navigation) ──
  readonly products = this.store.products;
  readonly loading  = this.store.loading;

  // ── Local UI state ────────────────────────────────────
  saving        = signal(false);
  searchQuery   = signal('');

  // ── Drawer state ──────────────────────────────────────
  drawerOpen   = signal(false);
  drawerMode   = signal<'add' | 'edit'>('add');
  editingId    = signal<string | null>(null);

  // ── Image state ───────────────────────────────────────
  drawerImages    = signal<ProductImage[]>([]);
  imgAdding       = signal(false);
  newImageUrl     = '';
  newImageAlt     = '';
  // staged image for create mode (product must exist before image can be POSTed)
  stagedImageUrl  = '';
  stagedImageAlt  = '';

  deleteConfirmId = signal<string | null>(null);

  // ── Recipe (ingredientes/insumos) ─────────────────────
  // Edit: se persiste al vuelo contra la API (/products/{id}/recipe).
  // Add:  se stagea local y se hace POST tras crear el producto.
  recipeItems       = signal<RecipeItem[]>([]);
  recipeLoading     = signal(false);   // GET inicial en modo edición
  recipeBusy        = signal(false);   // add/remove en vuelo (modo edición)
  selectedInsumoId  = '';
  selectedInsumoQty = 1;

  // ── Form ──────────────────────────────────────────────
  form = this.fb.group({
    name:                   ['', Validators.required],
    description:            [''],
    price:                  [0, [Validators.required, Validators.min(0.01)]],
    // restaurant
    categoria:              ['plato_fuerte'],
    tiempo_preparacion_min: [15],
    picante:                [false],
    // optician
    esfera:                 ['0.00'],
    cilindro:               ['0.00'],
    eje:                    [0],
    material:               ['CR-39'],
  });

  // ── Computed ──────────────────────────────────────────
  /** Base list: only finished goods (insumos go to Inventory page) */
  private finalProducts = computed(() => this.products().filter(p => p.product_type === 'final'));

  /** Insumos available to attach as ingredients/recipe items */
  availableInsumos = computed(() => this.products().filter(p => p.product_type === 'insumo'));

  filteredProducts = computed(() => {
    const q = this.searchQuery().toLowerCase();
    return this.finalProducts().filter(p =>
      !q || p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q)
    );
  });

  counts = computed(() => ({ all: this.finalProducts().length }));

  isRestaurant = computed(() => this.session?.business_type === 'restaurant');
  isOptician   = computed(() => this.session?.business_type === 'optician');

  primaryImage = (images: ProductImage[]) =>
    images.find(i => i.sort_order === 0) ?? images[0] ?? null;

  categorias = ['entrada', 'plato_fuerte', 'postre', 'bebida', 'guarnicion'];
  alergenos  = ['gluten', 'lacteos', 'huevo', 'nueces', 'mariscos', 'soya'];
  selectedAlergenos: string[] = [];

  // ── Lifecycle ─────────────────────────────────────────
  ngOnInit(): void {
    this.session = this.auth.getSession();
    this.store.load();   // no-op if cache is fresh; fetches only when stale/empty
  }

  // ── Search ────────────────────────────────────────────
  onSearch(e: Event): void { this.searchQuery.set((e.target as HTMLInputElement).value); }

  // ── Drawer open/close ─────────────────────────────────
  openAdd(): void {
    this.drawerMode.set('add');
    this.editingId.set(null);
    this.selectedAlergenos = [];
    this.stagedImageUrl = '';
    this.stagedImageAlt = '';
    this.drawerImages.set([]);
    this.recipeItems.set([]);
    this.recipeLoading.set(false);
    this.selectedInsumoId = '';
    this.selectedInsumoQty = 1;
    this.form.reset({
      price: 0,
      categoria: 'plato_fuerte', tiempo_preparacion_min: 15, picante: false,
      esfera: '0.00', cilindro: '0.00', eje: 0, material: 'CR-39'
    });
    this.drawerOpen.set(true);
  }

  openEdit(p: Product): void {
    this.drawerMode.set('edit');
    this.editingId.set(p.product_id);
    this.selectedAlergenos = p.metadata?.['alergenos'] ?? [];
    this.newImageUrl = '';
    this.newImageAlt = '';
    this.drawerImages.set([...(p.images ?? [])].sort((a, b) => a.sort_order - b.sort_order));
    this.recipeItems.set([]);
    this.selectedInsumoId = '';
    this.selectedInsumoQty = 1;
    // La receta vive en el backend; se carga bajo demanda al abrir el drawer.
    this.recipeLoading.set(true);
    this.recipeSvc.get(p.product_id).subscribe({
      next: (recipe) => { this.recipeItems.set(recipe.items); this.recipeLoading.set(false); },
      error: () => { this.recipeItems.set([]); this.recipeLoading.set(false); }
    });
    this.form.patchValue({
      name:                   p.name,
      description:            p.description,
      price:                  parseFloat(p.price),
      categoria:              p.metadata?.['categoria']              ?? 'plato_fuerte',
      tiempo_preparacion_min: p.metadata?.['tiempo_preparacion_min'] ?? 15,
      picante:                p.metadata?.['picante']                ?? false,
      esfera:                 p.metadata?.['esfera']                 ?? '0.00',
      cilindro:               p.metadata?.['cilindro']               ?? '0.00',
      eje:                    p.metadata?.['eje']                    ?? 0,
      material:               p.metadata?.['material']               ?? 'CR-39',
    });
    this.drawerOpen.set(true);
  }

  closeDrawer(): void { this.drawerOpen.set(false); }

  // ── Alergenos ─────────────────────────────────────────
  toggleAlergen(a: string): void {
    const i = this.selectedAlergenos.indexOf(a);
    if (i >= 0) this.selectedAlergenos.splice(i, 1);
    else this.selectedAlergenos.push(a);
  }
  isAlergenSelected(a: string): boolean { return this.selectedAlergenos.includes(a); }

  // ── Recipe (ingredientes) ──────────────────────────────
  addIngredient(): void {
    const insumoId = this.selectedInsumoId;
    if (!insumoId || this.recipeBusy()) return;
    const insumo = this.availableInsumos().find(i => i.product_id === insumoId);
    if (!insumo) return;
    // La receta usa cantidades enteras (unidades de stock del insumo por unidad vendida).
    const quantity = Math.max(1, Math.floor(this.selectedInsumoQty || 1));

    const editingId = this.editingId();
    if (editingId) {
      // ── Edit: upsert contra la API, la receta persiste al vuelo ──
      this.recipeBusy.set(true);
      this.recipeSvc.addItem(editingId, insumoId, quantity).subscribe({
        next: (recipe) => {
          this.recipeItems.set(recipe.items);
          this.recipeBusy.set(false);
          this.selectedInsumoId = '';
          this.selectedInsumoQty = 1;
        },
        error: (err: any) => {
          this.recipeBusy.set(false);
          this.snack.error(err.error?.error ?? 'No se pudo agregar el ingrediente.');
        }
      });
    } else {
      // ── Add: staging local (el producto aún no existe) ──
      this.recipeItems.update(items => {
        const existing = items.find(i => i.insumo_id === insumoId);
        if (existing) {
          return items.map(i => i.insumo_id === insumoId ? { ...i, quantity } : i);
        }
        return [...items, { insumo_id: insumoId, insumo_name: insumo.name, quantity, unit: '' }];
      });
      this.selectedInsumoId = '';
      this.selectedInsumoQty = 1;
    }
  }

  removeIngredient(insumoId: string): void {
    if (this.recipeBusy()) return;
    const editingId = this.editingId();
    if (editingId) {
      this.recipeBusy.set(true);
      this.recipeSvc.removeItem(editingId, insumoId).subscribe({
        next: (recipe) => { this.recipeItems.set(recipe.items); this.recipeBusy.set(false); },
        error: (err: any) => {
          this.recipeBusy.set(false);
          this.snack.error(err.error?.error ?? 'No se pudo quitar el ingrediente.');
        }
      });
    } else {
      this.recipeItems.update(items => items.filter(i => i.insumo_id !== insumoId));
    }
  }

  // ── Save product ──────────────────────────────────────
  saveProduct(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    this.saving.set(true);

    const v = this.form.value;
    // La receta ya NO vive en metadata — se gestiona con la API de recetas.
    const metadata = this.isRestaurant()
      ? { categoria: v.categoria, tiempo_preparacion_min: v.tiempo_preparacion_min, picante: v.picante,
          ...(this.selectedAlergenos.length ? { alergenos: this.selectedAlergenos } : {}) }
      : { esfera: v.esfera, cilindro: v.cilindro, eje: v.eje, material: v.material };

    // Finished goods don't track their own stock count — restaurants/opticians
    // can't sensibly say "I have 3 lasagna plates left". Stock tracking applies
    // to insumos only (see Inventory page). Send neutral defaults.
    const body = { product_type: 'final', name: v.name, description: v.description || '',
                   price: v.price, inventory_count: 0, low_stock_threshold: 1, metadata };

    const id = this.editingId();

    if (id) {
      // ── Edit ──
      this.store.update(id, body).subscribe({
        next: () => {
          this.saving.set(false);
          this.closeDrawer();
          this.snack.success('Producto actualizado.');
        },
        error: (err: any) => {
          this.saving.set(false);
          this.snack.error(err.error?.error ?? 'Error al guardar.');
        }
      });
    } else {
      // ── Create ──
      this.store.create(body).subscribe({
        next: (created) => this.persistStagedThenClose(created.product_id),
        error: (err: any) => {
          this.saving.set(false);
          this.snack.error(err.error?.error ?? 'Error al crear el producto.');
        }
      });
    }
  }

  /**
   * Tras crear un producto: sube la imagen staged y los ingredientes staged.
   * La receta requiere que el producto exista, por eso se hace aquí y no antes.
   */
  private persistStagedThenClose(productId: string): void {
    const tasks = [];

    if (this.stagedImageUrl.trim()) {
      tasks.push(
        this.imgSvc.add(productId, {
          url: this.stagedImageUrl.trim(),
          ...(this.stagedImageAlt.trim() ? { alt_text: this.stagedImageAlt.trim() } : {}),
          sort_order: 0
        }).pipe(catchError(() => { this.snack.warning('Producto creado, pero no se pudo guardar la imagen.'); return of(null); }))
      );
    }

    for (const item of this.recipeItems()) {
      tasks.push(
        this.recipeSvc.addItem(productId, item.insumo_id, item.quantity)
          .pipe(catchError(() => { this.snack.warning(`No se pudo agregar el ingrediente "${item.insumo_name}".`); return of(null); }))
      );
    }

    const finish = () => {
      this.saving.set(false);
      this.closeDrawer();
      this.snack.success('Producto creado exitosamente.');
    };

    if (tasks.length === 0) { finish(); return; }
    forkJoin(tasks).subscribe({ next: finish, error: finish });
  }

  // ── Image management (edit drawer) ────────────────────
  addImage(): void {
    const url = this.newImageUrl.trim();
    if (!url) return;
    const productId = this.editingId();
    if (!productId) return;

    this.imgAdding.set(true);
    const nextOrder = this.drawerImages().length === 0
      ? 0
      : Math.max(...this.drawerImages().map(i => i.sort_order)) + 1;

    this.imgSvc.add(productId, {
      url,
      ...(this.newImageAlt.trim() ? { alt_text: this.newImageAlt.trim() } : {}),
      sort_order: nextOrder
    }).subscribe({
      next: (img) => {
        this.drawerImages.update(imgs => [...imgs, img]);
        this.newImageUrl = '';
        this.newImageAlt = '';
        this.imgAdding.set(false);
        this.snack.success('Imagen agregada.');
        this.refreshProductImages(productId);
      },
      error: (err: any) => {
        this.imgAdding.set(false);
        this.snack.error(err.error?.error ?? 'No se pudo agregar la imagen.');
      }
    });
  }

  removeImage(img: ProductImage): void {
    const productId = this.editingId();
    if (!productId) return;

    this.imgSvc.remove(productId, img.image_id).subscribe({
      next: () => {
        this.drawerImages.update(imgs => imgs.filter(i => i.image_id !== img.image_id));
        this.snack.success('Imagen eliminada.');
        this.refreshProductImages(productId);
      },
      error: () => this.snack.error('No se pudo eliminar la imagen.')
    });
  }

  setPrimary(img: ProductImage): void {
    const productId = this.editingId();
    if (!productId || img.sort_order === 0) return;

    this.imgSvc.update(productId, img.image_id, { sort_order: 0 }).subscribe({
      next: (updated) => {
        this.drawerImages.update(imgs =>
          imgs.map(i => i.image_id === updated.image_id ? updated : i)
              .sort((a, b) => a.sort_order - b.sort_order)
        );
        this.snack.success('Imagen principal actualizada.');
        this.refreshProductImages(productId);
      },
      error: () => this.snack.error('No se pudo actualizar la imagen.')
    });
  }

  private refreshProductImages(productId: string): void {
    this.imgSvc.list(productId).subscribe({
      next: (imgs) =>
        this.store.updateImages(productId, imgs.sort((a, b) => a.sort_order - b.sort_order))
    });
  }

  // ── Delete product ────────────────────────────────────
  confirmDelete(id: string): void { this.deleteConfirmId.set(id); }
  cancelDelete(): void            { this.deleteConfirmId.set(null); }

  deleteProduct(id: string): void {
    this.store.remove(id).subscribe({
      next: () => {
        this.deleteConfirmId.set(null);
        this.snack.success('Producto eliminado.');
      },
      error: () => {
        this.deleteConfirmId.set(null);
        this.snack.error('No se pudo eliminar el producto.');
      }
    });
  }

  // ── Helpers ───────────────────────────────────────────
  metaLabel(p: Product): string {
    if (this.isRestaurant()) return p.metadata?.['categoria'] ?? '';
    if (this.isOptician())   return `${p.metadata?.['esfera']} / ${p.metadata?.['cilindro']}`;
    return '';
  }
}
