# SS Family Travel Console

公開、唯讀的家庭旅行參考頁面，顯示已去識別化的行程摘要、公開 Google Maps 導航連結，以及 Leaflet + OpenStreetMap 方位地圖。

## 隱私與公開範圍

這個公開版本刻意不含姓名、聯絡方式、訂位／票券識別碼、住宿細節、付款資料、私人文件連結、帳號、憑證或內部來源識別資訊。頁面不連線到任何私人資料來源；地圖頁只會向 Leaflet CDN 與 OpenStreetMap 請求公開地圖資源。

內容為旅行方位參考，並非即時交通、天氣、道路、營業或預訂狀態。候選、備案與待確認項目不代表最終行程。

## 本機驗證

```bash
npm test
npm run validate
python3 -m http.server 4173 --bind 127.0.0.1
```

GitHub Pages 會透過 `.github/workflows/deploy-pages.yml` 自動發布 `main` 分支內容。
