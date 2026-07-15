import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { AuthService, UserSession } from '../../core/services/auth.service';
import { SnackbarService } from '../../core/services/snackbar.service';
import { Branding, BrandingService } from '../../core/services/branding.service';

// Defaults de KARD (mismos que usa el storefront del cliente)
const DEFAULT_PRIMARY = '#5b6ef5';
const DEFAULT_ACCENT  = '#1e3a8a';

interface SampleProduct { name: string; desc: string; price: string; chip: string; }
interface Preset { label: string; primary: string; accent: string; }

@Component({
  selector: 'app-personalization',
  imports: [],
  templateUrl: './personalization.component.html',
  styleUrl: './personalization.component.scss'
})
export class PersonalizationComponent implements OnInit {
  private auth     = inject(AuthService);
  private branding = inject(BrandingService);
  private snack    = inject(SnackbarService);

  session: UserSession | null = null;

  readonly DEFAULT_PRIMARY = DEFAULT_PRIMARY;
  readonly DEFAULT_ACCENT  = DEFAULT_ACCENT;

  // ── Estado de carga ───────────────────────────────────
  loading = signal(true);
  saving  = signal(false);

  // ── Draft (los cambios en vivo) ───────────────────────
  logoUrl   = signal('');
  bannerUrl = signal('');
  primary   = signal('');   // '' = sin definir → usa el default en el preview
  accent    = signal('');

  // Snapshot de lo último guardado, para detectar cambios / descartar
  private saved = signal<Branding>({ logo_url: null, banner_url: null, theme: { primary: null, accent: null } });

  // ── UI ────────────────────────────────────────────────
  device      = signal<'desktop' | 'mobile'>('desktop');
  editingSpot = signal<'logo' | 'banner' | null>(null);   // popover de hotspot abierto
  focusedColor = signal<'primary' | 'accent' | null>(null); // resalta dónde aplica el color

  // Paletas curadas (primary = acentos/botones · accent = precios/CTA). Contraste OK.
  presets: Preset[] = [
    { label: 'Índigo',   primary: '#5b6ef5', accent: '#1e3a8a' },
    { label: 'Océano',   primary: '#0ea5e9', accent: '#075985' },
    { label: 'Esmeralda',primary: '#059669', accent: '#064e3b' },
    { label: 'Vino',     primary: '#e11d48', accent: '#881337' },
    { label: 'Violeta',  primary: '#7c3aed', accent: '#4c1d95' },
    { label: 'Grafito',  primary: '#475569', accent: '#1e293b' },
  ];

  // ── Derivados ─────────────────────────────────────────
  isRestaurant = computed(() => this.session?.business_type === 'restaurant');
  isOptician   = computed(() => this.session?.business_type === 'optician');

  /** CSS variables que alimentan el preview (con fallback a los defaults de KARD). */
  previewVars = computed(() => ({
    '--sf-primary': this.primary() || DEFAULT_PRIMARY,
    '--sf-accent':  this.accent()  || DEFAULT_ACCENT,
  }));

  /** ¿Hay cambios sin guardar respecto al último guardado? */
  dirty = computed(() => {
    const s = this.saved();
    return (this.logoUrl()   || null) !== s.logo_url
        || (this.bannerUrl() || null) !== s.banner_url
        || (this.primary()   || null) !== s.theme.primary
        || (this.accent()    || null) !== s.theme.accent;
  });

  storeName = computed(() => this.isOptician() ? 'Tu Óptica' : this.isRestaurant() ? 'Tu Restaurante' : 'Tu Negocio');
  typeLabel = computed(() => this.isOptician() ? 'Óptica' : this.isRestaurant() ? 'Restaurante' : 'Tienda');

  sampleProducts = computed<SampleProduct[]>(() => {
    if (this.isOptician()) return [
      { name: 'Lente CR-39',        desc: 'Monofocal orgánico estándar',      price: '350.00', chip: 'CR-39' },
      { name: 'Lente Antirreflejo', desc: 'Policarbonato con tratamiento',    price: '780.00', chip: 'Policarbonato' },
      { name: 'Armazón Clásico',    desc: 'Acetato, ligero y resistente',     price: '1200.00', chip: 'Acetato' },
    ];
    return [
      { name: 'Enchiladas Verdes', desc: 'Tortillas en salsa verde con crema', price: '8.50',  chip: 'Plato fuerte' },
      { name: 'Chilaquiles',       desc: 'Tortilla y salsa verde',             price: '20.00', chip: '15 min' },
      { name: 'Lasaña',            desc: 'Pasta al horno con carne',           price: '25.00', chip: 'Plato fuerte' },
    ];
  });

  // ── Ciclo de vida ─────────────────────────────────────
  ngOnInit(): void {
    this.session = this.auth.getSession();
    this.branding.get().subscribe({
      next: (b) => { this.applyToDraft(b); this.saved.set(b); this.loading.set(false); },
      error: () => { this.loading.set(false); this.snack.error('No se pudo cargar la personalización.'); }
    });
  }

  private applyToDraft(b: Branding): void {
    this.logoUrl.set(b.logo_url ?? '');
    this.bannerUrl.set(b.banner_url ?? '');
    this.primary.set(b.theme?.primary ?? '');
    this.accent.set(b.theme?.accent ?? '');
  }

  // ── Hotspots (logo / banner) ──────────────────────────
  openSpot(spot: 'logo' | 'banner'): void { this.editingSpot.set(spot); }
  closeSpot(): void { this.editingSpot.set(null); }

  setLogo(url: string):   void { this.logoUrl.set(url.trim()); }
  setBanner(url: string): void { this.bannerUrl.set(url.trim()); }
  clearLogo():   void { this.logoUrl.set(''); this.closeSpot(); }
  clearBanner(): void { this.bannerUrl.set(''); this.closeSpot(); }

  logoInitial = computed(() => this.storeName().charAt(0).toUpperCase());

  // ── Colores ───────────────────────────────────────────
  applyPreset(p: Preset): void { this.primary.set(p.primary); this.accent.set(p.accent); }
  setPrimary(hex: string): void { this.primary.set(this.normalizeHex(hex)); }
  setAccent(hex: string):  void { this.accent.set(this.normalizeHex(hex)); }
  resetColors(): void { this.primary.set(''); this.accent.set(''); }

  private normalizeHex(v: string): string {
    let h = v.trim();
    if (h && !h.startsWith('#')) h = '#' + h;
    return h;
  }

  isValidHex(hex: string): boolean { return /^#([0-9a-fA-F]{6})$/.test(hex); }

  /** Contraste del color contra blanco (sirve para texto-en-blanco y texto-blanco-en-color). */
  contrastVsWhite(hex: string): number {
    const rgb = this.hexToRgb(hex);
    if (!rgb) return 0;
    const L = this.luminance(rgb);
    return (1 + 0.05) / (L + 0.05);   // luminancia del blanco = 1
  }

  contrastLabel(hex: string): { text: string; level: 'ok' | 'warn' | 'bad' } {
    if (!this.isValidHex(hex)) return { text: '—', level: 'warn' };
    const r = this.contrastVsWhite(hex);
    if (r >= 4.5) return { text: 'Contraste óptimo',   level: 'ok' };
    if (r >= 3)   return { text: 'Contraste aceptable', level: 'warn' };
    return { text: 'Contraste bajo', level: 'bad' };
  }

  private hexToRgb(hex: string): [number, number, number] | null {
    const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  private luminance([r, g, b]: [number, number, number]): number {
    const a = [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
  }

  // ── Guardar / descartar ───────────────────────────────
  save(): void {
    if (this.saving()) return;
    // Validar hex antes de mandar (el backend igual valida, pero evitamos el 422)
    if ((this.primary() && !this.isValidHex(this.primary())) ||
        (this.accent()  && !this.isValidHex(this.accent()))) {
      this.snack.error('Revisa los colores: deben ser hex #RRGGBB.');
      return;
    }
    this.saving.set(true);
    const payload: Branding = {
      logo_url:   this.logoUrl()   || null,
      banner_url: this.bannerUrl() || null,
      theme: { primary: this.primary() || null, accent: this.accent() || null },
    };
    this.branding.update(payload).subscribe({
      next: (b) => { this.saved.set(b); this.applyToDraft(b); this.saving.set(false); this.snack.success('Personalización guardada.'); },
      error: (err: any) => {
        this.saving.set(false);
        this.snack.error(err.error?.error ?? err.error?.detail?.[0]?.msg ?? 'No se pudo guardar.');
      }
    });
  }

  discard(): void { this.applyToDraft(this.saved()); this.closeSpot(); }
}
