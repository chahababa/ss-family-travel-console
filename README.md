# SS Family Travel Console

公開、唯讀的家庭旅行參考頁面，顯示由使用者指定正式版行程同步而來的去識別化摘要、特色與歷史介紹、行程庫候選項目、官方參考來源、公開 Google Maps 導航連結，以及 Leaflet + OpenStreetMap 方位地圖。

## 隱私與公開範圍

這個公開版本刻意不含姓名、聯絡方式、訂位／票券識別碼、住宿細節、付款資料、私人文件連結、帳號、憑證或內部來源識別資訊。頁面不連線到任何私人資料來源；介紹頁的官方連結只在使用者點擊後開啟，地圖頁只會向 Leaflet CDN 與 OpenStreetMap 請求公開地圖資源。

正式版同步只保留日期、地區、活動順序、公開導航與狀態；來源試算表中的住宿名稱／地址、訂位代碼、價格、保險、財務與私人接送資料均不會進入公開快照。

內容為旅行方位參考，並非即時交通、天氣、道路、營業或預訂狀態。候選、備案與待確認項目不代表最終行程。

## 本機驗證

```bash
npm test
npm run validate
python3 -m http.server 4173 --bind 127.0.0.1
```

GitHub Pages 會透過 `.github/workflows/deploy-pages.yml` 自動發布 `main` 分支內容。
