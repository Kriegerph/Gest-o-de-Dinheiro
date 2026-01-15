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
    { label: 'Contas', icon: 'bi-wallet2', path: '/app/accounts' },
    { label: 'Investimentos', icon: 'bi-graph-up-arrow', path: '/app/investments' },
    { label: 'Categorias', icon: 'bi-collection', path: '/app/categories' },
    { label: 'Metas', icon: 'bi-bullseye', path: '/app/budgets' },
    { label: 'Relatórios', icon: 'bi-graph-up', path: '/app/reports' },
    { label: 'Cr\u00e9dito', icon: 'bi-credit-card-2-front', path: '/app/credit' },
    { label: 'Ajuda', icon: 'bi-question-circle', path: '/app/ajuda' },
    { label: 'Configurações', icon: 'bi-gear', path: '/app/settings' }
  ];
}

