# GestaoDeGastos (Angular standalone + Firebase)

Aplicação web completa para gestão de gastos com autenticação e Firestore multiusuário. Tudo já vem configurado com Firebase modular (sem compat) e Bootstrap 5 com visual futurista.

## Como rodar
- `npm install`
- `npm start` ou `ng serve -o`
- A aplicação abre em `/auth/login`. Registre-se para acessar o shell `/app/...`.

## Firebase
- Configuração já aplicada em `src/environments/environment.ts`.
- Firestore estruturado em `users/{uid}/...` para isolar dados por usuário.
- Regras recomendadas (publique em Firestore Rules):
  ```
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {
      match /users/{userId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;

        match /{document=**} {
          allow read, write: if request.auth != null && request.auth.uid == userId;
        }
      }
    }
  }
  ```

## Funcionalidades
- Cadastro/login com Firebase Auth.
- Sidebar + navbar reativas, botão sair instantâneo.
- Abas privadas: Dashboard, Lançamentos, Categorias, Metas, Relatórios, Configurações.
- Categorias: CRUD completo, bloqueio de exclusão se em uso, seed automático padrão.
- Lançamentos: CRUD de receitas/despesas, despesa exige categoria, receita não.
- Metas: metas mensais por categoria com cálculo de gasto real, restante, % e barra de progresso.
- Relatórios: filtro por data, totais (entradas/saídas/saldo), tabela por categoria, lista de lançamentos, exportação CSV.
- Configurações: editar perfil, trocar e-mail e senha com reautenticação.

## Observações
- Projeto totalmente standalone (sem AppModule) e sem import de `firebase/auth` ou `firebase/firestore` direto.
- Firebase inicializado apenas em `src/app/app.config.ts` via `provideFirebaseApp`/`provideAuth`/`provideFirestore`.
- Bootstrap 5 e Bootstrap Icons incluídos em `angular.json`.
