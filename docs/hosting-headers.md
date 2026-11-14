# 公開するときの設定(HTTP ヘッダ)

このアプリは、ビルド結果(`npm run build` の `dist/`)を、そのまま静的ホスティングに置けば動きます。
そのとき、EDINET から自動で取得する機能(中継)は使えません。手元のファイルの取り込みだけが使えます(画面にも、その案内が出ます)。

## 置く前に

`dist/` には、**API キーも、`.env` も入りません**(ビルド後に、キーの値と EDINET の接続先が含まれないことを確かめています)。
それでも、公開用のホスティングに、`.env` や `.cache` を置かないでください。

## ヘッダ

Content-Security-Policy は、`index.html` に meta タグとして入っていますが、`frame-ancestors`(他のサイトの `<iframe>` への埋め込みの拒否)は、meta では効きません。
HTTP ヘッダとして返すと、次の守りが加わります。

| ヘッダ | 目的 |
| --- | --- |
| Content-Security-Policy | 外部への通信・外部のスクリプトを許さない。`frame-ancestors 'none'` で、埋め込みを断る |
| X-Content-Type-Options: nosniff | ファイルの種類の取り違えを防ぐ |
| X-Frame-Options: DENY | 古いブラウザ向けの、埋め込みの拒否 |
| Referrer-Policy | 他のサイトへ送る参照元を、必要最小限にする |
| Permissions-Policy | カメラ・マイク・位置情報・決済を使わせない |
| Strict-Transport-Security | HTTPS だけを使わせる |

## Netlify・Cloudflare Pages

`npm run build` が、`dist/_headers` を作ります(`server/securityHeaders.ts` の定義から生成。meta の CSP と同じ内容です)。
`dist/` を置くだけで効きます。

## Vercel

プロジェクトの根に `vercel.json` を置き、同じヘッダを書きます(値は `dist/_headers` と同じにしてください)。

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Content-Security-Policy", "value": "(dist/_headers の Content-Security-Policy と同じ)" },
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "X-Frame-Options", "value": "DENY" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "Permissions-Policy", "value": "camera=(), microphone=(), geolocation=(), payment=()" },
        { "key": "Strict-Transport-Security", "value": "max-age=31536000" }
      ]
    },
    {
      "source": "/assets/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    }
  ]
}
```

## 確認

公開したあと、ブラウザの開発者ツール(ネットワーク)で、ページのレスポンスヘッダに、上の表のヘッダが付いていること、
コンソールに CSP の違反が出ていないことを確かめてください。
