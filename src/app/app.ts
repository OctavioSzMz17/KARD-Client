import { Component, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterOutlet } from '@angular/router';
import { SnackbarComponent } from './core/components/snackbar/snackbar.component';
import { TestBannerComponent } from './core/components/test-banner/test-banner.component';
import { BRAND_NAME } from './shared/brand';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, SnackbarComponent, TestBannerComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  constructor() {
    // El título de la pestaña sale de la marca, no de un texto fijo en index.html.
    inject(Title).setTitle(BRAND_NAME);
  }
}
