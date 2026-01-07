import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.css'
})
export class SidebarComponent {
  @Input() isOpen = true;
  @Output() navigate = new EventEmitter<void>();

  readonly links = [
    { label: 'Dashboard', icon: 'bi-speedometer2', path: '/app/dashboard' },
    { label: 'Lançamentos', icon: 'bi-arrow-left-right', path: '/app/transactions' },
    { label: 'Categorias', icon: 'bi-collection', path: '/app/categories' },
    { label: 'Metas', icon: 'bi-bullseye', path: '/app/budgets' },
    { label: 'Relatórios', icon: 'bi-graph-up', path: '/app/reports' },
    { label: 'Configurações', icon: 'bi-gear', path: '/app/settings' }
  ];
}
