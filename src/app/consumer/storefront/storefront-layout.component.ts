import { Component, computed, inject, OnInit } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { StorefrontStore } from '../../core/store/storefront.store';

const TYPE_LABELS: Record<string, string> = {
  restaurant: 'Restaurante',
  optician:   'Óptica',
};

@Component({
  selector: 'app-storefront-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './storefront-layout.component.html',
  styleUrl: './storefront-layout.component.scss'
})
export class StorefrontLayoutComponent implements OnInit {
  readonly sf = inject(StorefrontStore);
  private auth   = inject(AuthService);
  private route  = inject(ActivatedRoute);
  private router = inject(Router);

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug') ?? '';
    this.sf.init(slug);
  }

  typeLabel = computed(() => {
    const t = this.sf.store()?.business_type;
    return t ? (TYPE_LABELS[t] ?? t) : '';
  });

  storeInitial = computed(() => this.sf.store()?.business_name?.charAt(0)?.toUpperCase() ?? '?');

  /** Datos de contacto — el backend aún no los envía; el footer se adapta. */
  contact = computed(() => this.sf.store()?.contact ?? null);

  hasAnyContact = computed(() => {
    const c = this.contact();
    if (!c) return false;
    return !!(c.address || c.phone || c.email || c.whatsapp || c.maps_url || c.hours?.length);
  });

  socialLinks = computed(() => {
    const s = this.contact()?.social;
    if (!s) return [] as { key: string; url: string }[];
    return (['facebook', 'instagram', 'tiktok', 'x', 'youtube'] as const)
      .map(key => ({ key, url: s[key] ?? '' }))
      .filter(l => !!l.url);
  });

  /** wa.me acepta el número sin símbolos; si ya es un link, se usa tal cual. */
  whatsappHref = computed(() => {
    const w = this.contact()?.whatsapp;
    if (!w) return '';
    if (w.startsWith('http')) return w;
    return `https://wa.me/${w.replace(/[^\d]/g, '')}`;
  });

  year = new Date().getFullYear();

  backToExplore(): void { this.router.navigate(['/explore']); }
  logout(): void { this.auth.logout(); }
}
