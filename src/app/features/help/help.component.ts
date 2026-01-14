import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

type HelpSection = {
  id: string;
  title: string;
  summary: string;
  what: string;
  how: string[];
  tips: string[];
  notes: string[];
};

type FaqItem = {
  question: string;
  answer: string;
};

type QuickLink = {
  label: string;
  path: string;
};

@Component({
  selector: 'app-help',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './help.component.html',
  styleUrl: './help.component.css'
})
export class HelpComponent {
  query = '';

  readonly quickLinks: QuickLink[] = [
    { label: 'Ir para Lançamentos', path: '/app/transactions' },
    { label: 'Ir para Contas', path: '/app/accounts' },
    { label: 'Ir para Relatórios', path: '/app/reports' }
  ];

  readonly sections: HelpSection[] = [
    {
      id: 'dashboard',
      title: 'Dashboard',
      summary: 'Visão geral do mês com saldos, despesas e gráficos.',
      what: 'Mostra o panorama financeiro do mês atual em cards e gráficos.',
      how: [
        'Confira o saldo geral e as entradas e saídas do mês no topo.',
        'Veja o saldo por conta para cada carteira ou banco.',
        'Análise a distribuição de gastos com as 5 categorias mais altas.',
        'Compare o fluxo diário no gráfico de entradas x saídas por dia.',
        'Observe a maior despesa e as últimas transações.'
      ],
      tips: [
        'Cadastre categorias e contas para deixar os gráficos mais completos.',
        'O gráfico de saldo por conta (donut) mostra o peso de cada conta no total.',
        'Use o dashboard para detectar picos de gasto e dias com maior receita.'
      ],
      notes: [
        'Saldo geral = soma dos saldos das contas (saldo inicial + entradas - saídas).',
        'Gráficos usam apenas lançamentos do mês atual.',
        'Lançamentos sem conta nao entram no saldo por conta.'
      ]
    },
    {
      id: 'lancamentos',
      title: 'Lançamentos',
      summary: 'Registro de receitas e despesas do dia a dia.',
      what: 'Área para criar, editar e excluir lançamentos financeiros.',
      how: [
        'Escolha o tipo: Receita ou Despesa.',
        'Preencha data, descrição, categoria, conta e valor.',
        'Adicione observações se precisar.',
        'Salve e acompanhe a lista para editar ou excluir.'
      ],
      tips: [
        'Use descrições claras para facilitar a busca.',
        'Sempre associe uma conta para manter os saldos corretos.',
        'Revise a data antes de salvar para manter o período correto.'
      ],
      notes: [
        'Editar ou excluir recalcula saldos e relatórios.',
        'O tipo define se o valor entra como entrada ou saída.'
      ]
    },
    {
      id: 'contas',
      title: 'Contas',
      summary: 'Carteiras, bancos e outros saldos separados.',
      what: 'Controla saldos por conta e o saldo geral do sistema.',
      how: [
        'Crie uma conta com nome e saldo inicial.',
        'Acompanhe o saldo atual atualizado pelos lançamentos.',
        'Edite ou remova contas quando necessário.'
      ],
      tips: [
        'Crie uma conta para dinheiro em espécie.',
        'Mantenha o saldo inicial fiél ao valor real.'
      ],
      notes: [
        'Saldo atual = saldo inicial + entradas - saídas vinculadas.',
        'Contas sem lançamentos mantém o saldo inicial.'
      ]
    },
    {
      id: 'categorias',
      title: 'Categorias',
      summary: 'Organização das receitas e despesas.',
      what: 'Classifica lançamentos por tipo e cor.',
      how: [
        'Crie categorias com nome, tipo e cor.',
        'Escolha o tipo correto: Receita ou Despesa.',
        'Use as categorias nos lançamentos.'
      ],
      tips: [
        'Use cores distintas para leitura rápida.',
        'Evite categorias em excesso para simplificar os gráficos.'
      ],
      notes: [
        'O tipo define onde a categoria aparece e como entra nos gráficos.'
      ]
    },
    {
      id: 'metas',
      title: 'Metas',
      summary: 'Limites de gasto por categoria e período.',
      what: 'Permite criar metas mensais para controlar despesas.',
      how: [
        'Selecione a categoria e informe o valor limite.',
        'Escolha mês e ano para o período.',
        'Acompanhe a barra de progresso do gasto.'
      ],
      tips: [
        'Comece com metas realistas e ajuste com o tempo.',
        'Revise metas no início de cada mês.'
      ],
      notes: [
        'O progresso usa os gastos da categoria no período selecionado.'
      ]
    },
    {
      id: 'relatorios',
      title: 'Relatórios',
      summary: 'Analise por periodo com exportação.',
      what: 'Gera resumo de entradas, saídas e saldo entre datas.',
      how: [
        'Defina a data inicial e final.',
        'Clique em gerar para ver o resumo do período.',
        'Use a lista de lançamentos para validar os dados.',
        'Exporte para Excel quando precisar.'
      ],
      tips: [
        'Use para fechar o mês ou comparar períodos diferentes.',
        'Combine com categorias para diagnósticos mais precisos.'
      ],
      notes: [
        'Os relatórios consideram a data informada no lançamento.'
      ]
    },
    {
      id: 'credito',
      title: 'Crédito (Cartão de crédito)',
      summary: 'Controle de compras parceladas e adiantamento de parcelas.',
      what:
        'Esta seção explica como funciona o controle de compras no cartão de crédito, o parcelamento, o adiantamento de parcelas e o impacto nos lançamentos e no saldo das contas.',
      how: [
        'Cadastre o cartão de crédito para registrar compras parceladas.',
        'Defina os dias de fechamento e vencimento (ex.: 29 e 7).',
        'Registre compras parceladas com valores e datas das parcelas.',
        'Se necessário, edite valores mantendo o histórico de parcelas pagas.',
        'Marque parcelas como pagas para adiantar o pagamento e gerar lançamento.'
      ],
      tips: [
        'Use a conta correta para que o saldo seja descontado corretamente.',
        'Parcelas já pagas permanecem marcadas mesmo ao editar valores da compra.',
        'Desmarcar uma parcela paga remove o lançamento relacionado.'
      ],
      notes: [
        'O mês e o ano são calculados automaticamente a cada ciclo.',
        'Vencimento é a data prevista; pagamento é a data em que a parcela foi marcada como paga.',
        'O vencimento da parcela não muda quando ela é paga antecipadamente.',
        'A data do lançamento é a data do pagamento (dia em que a parcela foi marcada como paga).',
        'Exemplo: parcela com vencimento em 29/01 paga antecipadamente em 13/01 aparecerá como "Paga em 13/01" e o lançamento será registrado em 13/01.'
      ]
    },
    {
      id: 'configuracoes',
      title: 'Configurações',
      summary: 'Perfil e segurança da conta.',
      what: 'Permite atualizar dados pessoais e credenciais.',
      how: [
        'Atualize nome e data de nascimento quando necessário.',
        'Altere e-mail e senha usando a senha atual.',
        'Se houver tema, ajuste a aparência preferida.'
      ],
      tips: [
        'Use senha forte e atualize periodicamente.',
        'Mantenha seus dados pessoais corretos.'
      ],
      notes: [
        'Algumas mudanças exigem confirmar a senha atual.',
        'Opções de tema aparecem apenas se estiverem habilitadas.'
      ]
    }
  ];

  readonly faqs: FaqItem[] = [
    {
      question: 'Por que meu saldo mudou?',
      answer:
        'O saldo muda quando você cria, edita ou exclui lançamentos e quando altera o saldo inicial das contas.'
    },
    {
      question: 'O que acontece se eu cadastrar um lançamento sem conta?',
      answer:
        'Ele aparece nos lançamentos, relatórios e gráficos do mês, mas não entra no saldo por conta nem no saldo geral.'
    },
    {
      question: 'Como funcionam os relatórios por período?',
      answer:
        'Eles filtram por data inicial e final, somam entradas e saídas e listam os lançamentos do intervalo.'
    }
  ];

  get filteredSections(): HelpSection[] {
    const query = this.query.trim().toLowerCase();
    if (!query) {
      return this.sections;
    }
    return this.sections.filter((section) => this.sectionMatches(section, query));
  }

  trackById(_: number, item: HelpSection) {
    return item.id;
  }

  private sectionMatches(section: HelpSection, query: string): boolean {
    const bucket = [
      section.title,
      section.summary,
      section.what,
      ...section.how,
      ...section.tips,
      ...section.notes
    ]
      .join(' ')
      .toLowerCase();
    return bucket.includes(query);
  }
}
