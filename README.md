# AN Pets

App web instalável (PWA) para a alimentação natural dos pets, criado a partir da planilha "AN Ana".
Os dados ficam no navegador do aparelho (localStorage) e, com login Google, também no Firebase,
para o mesmo histórico aparecer no PC e no celular.

## Rodar no computador

```bash
node server.js
```

Abra http://localhost:5180.

## Usar no celular

O app precisa estar publicado em HTTPS para ser instalado. Qualquer hospedagem de site estático serve
(GitHub Pages, Netlify, Cloudflare Pages): basta publicar o conteúdo desta pasta (o `server.js` não é necessário).
Depois, no celular:

- **Android (Chrome):** menu ⋮ → "Instalar app".
- **iPhone (Safari):** compartilhar → "Adicionar à Tela de Início".

## Arquivos

- `index.html`, `styles.css`, `app.js`: o app (sem dependências e sem build).
- `sync.js`: login Google e sincronização com o Firestore (SDK do Firebase via CDN).
- `sw.js`: funcionamento offline.
- `manifest.webmanifest`, `icons/`: instalação na tela inicial.

## Dados

- **Backup:** Ajustes → Exportar backup (JSON). Use o mesmo arquivo para passar os dados para outro aparelho.
- **Lembretes:** Ajustes → Baixar lembretes (.ics) para importar no Google Agenda ou no Calendário.
- **Calorias usadas:** as da planilha; fígado 1,35 kcal/g e óleo de coco 7,9 kcal/ml (USDA).
