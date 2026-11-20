import { Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterOutlet } from '@angular/router';
import { SnackbarComponent } from './core/components/snackbar/snackbar.component';
import { PlanNoticeComponent } from './core/components/plan-notice/plan-notice.component';
import { UpgradeDialogComponent } from './dashboard/subscription/upgrade-dialog/upgrade-dialog.component';
import { UpgradeService } from './core/services/upgrade.service';
import { TestBannerComponent } from './core/components/test-banner/test-banner.component';
import { BRAND_NAME } from './shared/brand';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SnackbarComponent, TestBannerComponent, PlanNoticeComponent, UpgradeDialogComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  /** El modal de mejora (flujo 15B) vive aquí para no perder lo que se esté capturando. */
  protected readonly upgrade = inject(UpgradeService);

  constructor() {
    // El título de la pestaña sale de la marca, no de un texto fijo en index.html.
    inject(Title).setTitle(BRAND_NAME);
  }
}
