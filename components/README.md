# Bộ Component Header & Footer Dùng Chung — Erasight Academy

Bộ component này giúp bạn dễ dàng tái sử dụng **Header** và **Footer** trên mọi trang web mới (như `courses.html`, `about.html`, `contact.html`, ...) mà không cần copy paste lặp lại mã nguồn nhiều lần.

---

## 📁 Cấu trúc thư mục

```text
Erasight-Course/
├── assets/
│   ├── css/
│   │   ├── style.css           # CSS giao diện tổng thể
│   │   └── header-footer.css   # ✨ CSS riêng độc lập cho Header & Footer
│   ├── js/
│   │   ├── main.js             # Logic riêng cho trang chủ
│   │   └── components.js       # ✨ Bộ nạp và điều khiển Header & Footer
│   └── logos/                  # Chứa logo chính thức có slogan
└── components/
    ├── header.html             # ✨ Mã HTML Header độc lập
    ├── footer.html             # ✨ Mã HTML Footer độc lập
    └── README.md               # Hướng dẫn tái sử dụng này
```

---

## 🚀 Cách 1: Nạp tự động bằng JavaScript (Khuyên Dùng — Cực nhanh & đồng bộ 100%)

Khi tạo một file HTML mới (ví dụ: `khoa-hoc.html`), bạn chỉ cần làm 3 bước:

### Bước 1: Nhúng file CSS vào `<head>`
```html
<link rel="stylesheet" href="assets/css/style.css" />
<link rel="stylesheet" href="assets/css/header-footer.css" />
```

### Bước 2: Đặt 2 thẻ giữ chỗ (placeholder) ở đầu và cuối `<body>`
```html
<body>
  <!-- Header tự động nạp vào đây -->
  <div id="site-header"></div>

  <!-- Nội dung trang của bạn -->
  <main>
    <h1>Nội dung trang mới...</h1>
  </main>

  <!-- Footer tự động nạp vào đây -->
  <div id="site-footer"></div>

  <!-- Bước 3: Nạp script components -->
  <script src="assets/js/components.js"></script>
</body>
```

> **Lợi ích**: Khi bạn sửa menu, logo hay số hotline, bạn chỉ cần sửa trong file `assets/js/components.js` hoặc `components/header.html`, **tất cả mọi trang sẽ tự động đồng bộ theo**, không bao giờ bị lệch!

---

## 🛠️ Cách 2: Nhúng trực tiếp mã HTML (Dành cho SEO thuần hoặc PHP / SSI)

Nếu bạn muốn mã HTML của Header & Footer nằm trực tiếp trong file HTML (để crawl bot SEO đọc ngay lập tức mà không cần chạy JS):

1. Mở file [components/header.html](file:///d:/Erasight-Course/components/header.html), copy toàn bộ nội dung và dán vào đầu thẻ `<body>`.
2. Mở file [components/footer.html](file:///d:/Erasight-Course/components/footer.html), copy toàn bộ nội dung và dán vào cuối thẻ `<body>`.
3. Nhúng:
   ```html
   <link rel="stylesheet" href="assets/css/header-footer.css" />
   <script src="assets/js/components.js"></script>
   ```
   *Script `components.js` sẽ tự nhận diện HTML đã có sẵn và kích hoạt menu mobile drawer, hiệu ứng dropdown Khoá học và popup Đăng nhập.*

---

## 💡 Lưu ý khi trang nằm trong thư mục con (ví dụ: `pages/course.html`)
Nếu bạn đặt file HTML trong thư mục con (ví dụ: `pages/`), hãy thêm thẻ meta sau vào `<head>`:
```html
<meta name="base-path" content="../" />
<link rel="stylesheet" href="../assets/css/header-footer.css" />
...
<script src="../assets/js/components.js"></script>
```
Script sẽ tự động hiểu và chỉnh đường dẫn logo, liên kết trang về đúng thư mục gốc.
