import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StorefrontStore } from '../../../core/store/storefront.store';

// Fallbacks mientras el backend no envíe tagline/description
const TYPE_TAGLINES: Record<string, string> = {
  restaurant: 'Cocina hecha al momento, como en casa.',
  optician:   'Cuidamos tu visión con atención personalizada.',
};

const TYPE_ABOUT: Record<string, string> = {
  restaurant: 'Preparamos cada platillo con ingredientes frescos y recetas cuidadas. Explora nuestro menú y ordena lo que se te antoje.',
  optician:   'Ofrecemos lentes, armazones y asesoría profesional para que veas mejor. Explora nuestro catálogo y encuentra lo que necesitas.',
};

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
    this.sf.store()?.tagline || TYPE_TAGLINES[this.type()] || 'Bienvenido a nuestra tienda.'
  );

  /** Descripción del negocio; fallback por rubro para no dejar la sección vacía. */
  description = computed(() =>
    this.sf.store()?.description || TYPE_ABOUT[this.type()] || 'Gracias por visitarnos. Explora nuestro catálogo.'
  );

  hasBanner = computed(() => !!this.sf.store()?.banner_url);

  storeInitial = computed(() => this.sf.store()?.business_name?.charAt(0)?.toUpperCase() ?? '?');
}
