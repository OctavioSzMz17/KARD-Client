import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StorefrontStore } from '../../../core/store/storefront.store';
import { businessTypeInfo } from '../../../shared/business-types';


@Component({
  selector: 'app-storefront-landing',
  imports: [RouterLink],
  templateUrl: './storefront-landing.component.html',
  styleUrl: './storefront-landing.component.scss'
})
export class StorefrontLandingComponent {
  readonly sf = inject(StorefrontStore);

  private type = computed(() => this.sf.store()?.business_type ?? '');

  /** Eslogan del negocio; si aún no lo definió, uno acorde a su rubro. */
  tagline = computed(() =>
    this.sf.store()?.tagline || businessTypeInfo(this.type())?.tagline || 'Bienvenido a nuestra tienda.'
  );

  /** Descripción del negocio; fallback por rubro para no dejar la sección vacía. */
  description = computed(() =>
    this.sf.store()?.description || businessTypeInfo(this.type())?.about || 'Gracias por visitarnos. Explora nuestro catálogo.'
  );

  hasBanner = computed(() => !!this.sf.store()?.banner_url);

  storeInitial = computed(() => this.sf.store()?.business_name?.charAt(0)?.toUpperCase() ?? '?');
}
