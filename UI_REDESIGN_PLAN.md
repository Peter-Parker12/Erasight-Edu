# Erasight Course — Kế hoạch Tái thiết kế Giao diện (UI Redesign Plan)

> **Dự án**: Erasight Course (Erasight Edu)  
> **Thư mục làm việc**: `D:\Erasight-Course` (Tuyệt đối độc lập, không can thiệp thư mục LMS khác)  
> **Tài liệu căn cứ**: *Erasight Edu — Brand Guideline v2.0 (Tháng 9/2026)* & *Bộ Logo Erasight Edu*  
> **Slogan thương hiệu**: `Skills for what's next.` *(Giữ nguyên tiếng Anh, không dịch, không dấu chấm than)*  
> **Tính cách thương hiệu**: **Thẳng thắn** (nói thật việc học được gì) — **Thực dụng** (dùng được vào thứ Hai tuần sau) — **Điềm tĩnh** (không viết hoa cả câu, không dấu chấm than).

---

## 1. Hệ thống Design Tokens (Design System Foundation)

Mọi thành phần UI của Erasight Course phải tuân thủ nghiêm ngặt bảng màu, hệ thống kiểu chữ và tỷ lệ bố cục đã được chuẩn hoá trong Brand Guideline.

### 1.1. Bảng màu chuẩn (Color Palette)

| Vai trò | Tên màu | Mã HEX | Quy tắc sử dụng |
| :--- | :--- | :--- | :--- |
| **Nền mặc định** | Trắng Sương | `#F6FAFA` | Nền chính toàn bộ hệ thống web |
| **Chữ chính / Dark** | Navy Sâu | `#0C2A3A` | Màu chữ chính, thanh tiêu đề tối, icon ứng dụng |
| **Nhận diện chính** | Xanh Ngọc | `#0DA096` | Màu chủ đạo, 2 lớp ngoài biểu tượng, mảng nhận diện thương hiệu |
| **Điểm nhấn / CTA** | Cam Khởi Đầu | `#E85D04` | **Tối đa ≤ 10% diện tích**. Dùng cho nút hành động chính (Primary CTA), badge nổi bật, nhánh AI Marketing |
| **Liên kết / Chữ xanh** | Xanh Ngọc Đậm | `#07736C` | Dùng cho link & text xanh trên nền sáng (thay vì #0DA096 để đảm bảo độ tương phản WCAG) |
| **Khối thông tin** | Ngọc Rất Nhạt | `#E2F5F3` | Nền các khối ghi chú, thông tin khoá học, callout card |
| **Khối nhấn nhẹ** | Cam Rất Nhạt | `#FDE7D6` | Nền nhẹ cho tag khuyến mãi, hạn chót đăng ký, ưu đãi |
| **Chữ phụ / Chú thích** | Xám Xanh | `#4A6470` | Text phụ, ngày khai giảng, thời lượng, metadata |
| **Nhánh English** | Lam Học Thuật | `#2176C7` | Màu nhận diện riêng của track Tiếng Anh đi làm (thay lớp giữa) |
| **Trạng thái thành công** | Xanh Đạt | `#2E9E4F` | Trạng thái hoàn thành, chứng nhận, đã nộp bài |
| **Đường viền** | Viền Bạc Nhạt | `#DDE7E7` | Border thẻ bài, đường phân cách nhẹ nhàng |

```css
/* CSS Variables Tokens */
:root {
  /* Brand Core */
  --color-bg-base: #F6FAFA;
  --color-text-main: #0C2A3A;
  --color-teal-brand: #0DA096;
  --color-teal-dark: #07736C;
  --color-orange-accent: #E85D04;
  
  /* Background Soft Tints */
  --color-teal-tint: #E2F5F3;
  --color-orange-tint: #FDE7D6;
  
  /* Neutral & Utility */
  --color-text-muted: #4A6470;
  --color-border: #DDE7E7;
  --color-blue-academic: #2176C7;
  --color-success: #2E9E4F;
  --color-white: #FFFFFF;
}
```

> **Quy tắc tương phản bắt buộc từ Guideline**:
> 1. Chữ trắng trên nền Xanh Ngọc (`#0DA096`) hoặc nền Cam (`#E85D04`) **chỉ dùng từ cỡ font 24px trở lên**.
> 2. Chữ xanh trên nền sáng **bắt buộc dùng Xanh Ngọc Đậm `#07736C`**, không dùng `#0DA096`.
> 3. Tỷ lệ màu Cam Khởi Đầu **không bao giờ vượt quá 1/10 (10%) diện tích màn hình**.

---

### 1.2. Hệ chữ ba vai rõ ràng (Typography Scale)

Cả 3 font đều có sẵn trên Google Fonts và hỗ trợ tiếng Việt đầy đủ:

1. **Chữ hiển thị (Headings & Brand Title)**: `Bricolage Grotesque`
   - Trọng số: `700` (Bold) và `800` (Extra Bold).
   - Letter-spacing: Âm `-0.02em` đến `-0.038em`.
   - Ứng dụng: Logo text, tiêu đề trang (H1, H2), tên khoá học, tiêu đề section.
2. **Chữ nội dung & Giao diện (Body & UI Elements)**: `Be Vietnam Pro`
   - Trọng số: `400` (Regular), `500` (Medium), `600` (SemiBold), `700` (Bold).
   - Được thiết kế tối ưu riêng cho dấu tiếng Việt, không bị cắt hay chạm dòng.
   - Chiều dài dòng tối đa: 68 ký tự để đảm bảo công năng đọc. Cỡ chữ trên điện thoại tối thiểu 16px.
3. **Số liệu & Nhãn kỹ thuật (Metrics & Badges)**: `JetBrains Mono`
   - Trọng số: `500` (Medium), `600` (SemiBold).
   - Ứng dụng: Học phí (`4.290.000₫`), mã khoá học (`MKT_001`), thời gian buổi học (`BUỔI 07 · 19H-21H`), nhãn trạng thái (`TL_002 · ĐANG THỰC HIỆN`), đồng hồ đếm ngược.

---

## 2. Kiến trúc Giao diện & Các Khối Chức năng (Layout & Components)

### 2.1. Thanh Điều Hướng (Navigation Bar)
- **Chiều cao logo**: Đúng chuẩn `28px`.
- **Khoảng thở quanh logo**: Tối thiểu `0.5 × chiều cao biểu tượng` (14px padding tối thiểu).
- **Cấu trúc Menu**:
  - Bên trái: Logo ngang Erasight Edu (`erasight-logo-ngang-mau-1600w.png`).
  - Ở giữa: Menu liên kết chính: `Khoá học`, `Lộ trình`, `Giảng viên`, `Phương pháp`.
  - Bên phải: Nút CTA Primary `Đăng ký học` (Cam Khởi Đầu `#E85D04`).
- **Hiệu ứng**: Nền kính mờ (Glassmorphism với `rgba(246, 250, 250, 0.85)` và `backdrop-filter: blur(12px)`).

### 2.2. Khối Hero (Hero Section)
- **Tagline**: `Skills for what's next.` (JetBrains Mono hoặc Bricolage nhỏ, màu `#07736C`).
- **Headline lớn**: *"Kỹ năng thực chiến cho kỷ nguyên mới"* (Bricolage Grotesque 800, 56px, màu Navy Sâu `#0C2A3A`).
- **Mô tả ngắn gọn**: *"Dạy những gì thị trường tuyển dụng đang thật sự cần. Học live và làm ra sản phẩm ứng dụng ngay vào thứ Hai tuần sau."* (Be Vietnam Pro, 18px, màu `#4A6470`).
- **Bộ số liệu chứng minh (Proof Metrics)**:
  - `100%` buổi học có sản phẩm mẫu thực chiến.
  - `Live & Mentoring 1:1` trong suốt lộ trình.
  - Giảng viên thực chiến: Hồ Hoàng Tiến & Chuyên gia công nghệ.
- **CTA Actions**:
  - Primary button: `Xem khoá học đang mở` (Cam Khởi Đầu).
  - Secondary button: `Tư vấn lộ trình học` (Khung viền `#DDE7E7`, text Navy Sâu).

### 2.3. Bộ lọc & Danh sách Khoá học (Course Catalog)
Phân loại theo cấu trúc nhánh đào tạo của Brand Guideline:
1. **Nhánh AI MARKETING** (Màu nhận diện: Cam Khởi Đầu `#E85D04`):
   - Ví dụ tiêu biểu: *Xây quy trình tự động hoá đăng bài*, *Sáng tạo nội dung đa kênh cùng Generative AI*.
   - Badge hiển thị: `AI MARKETING` (chữ in hoa, JetBrains Mono, màu cam).
2. **Nhánh ENGLISH** (Màu nhận diện: Lam Học Thuật `#2176C7`):
   - Ví dụ: *Tiếng Anh phỏng vấn & đi làm*, *English for Tech Professionals*.
   - Badge hiển thị: `ENGLISH` (màu lam `#2176C7`).
3. **Thẻ Khoá học (Course Card Component)**:
   - Thẻ nền trắng bo góc `16px`, viền `#DDE7E7`, bóng mờ êm dịu (`0 4px 20px rgba(12, 42, 58, 0.04)`).
   - Phần header thẻ: Badge ngành + Mã học phần (`MKT_001`).
   - Tên khoá học: Bricolage Grotesque 700.
   - Giảng viên & số buổi: `Hồ Hoàng Tiến · 3 buổi`.
   - Giá học phí: JetBrains Mono (ví dụ: `2.490.000₫` hoặc `4.290.000₫`).
   - Lịch học: `BUỔI 01-03 · 19H30-21H30`.

### 2.4. Triết lý đào tạo 3 lớp (The 3-Layer Learning Experience)
Minh hoạ trực quan từ biểu tượng logo Erasight:
- **Lớp 1: BIẾT (Foundation)** — Nắm vững tư duy lõi và công cụ thế hệ mới.
- **Lớp 2: LÀM ĐƯỢC (Application - Lớp trượt mang tính đột phá)** — Thực hành live từng thao tác trên dữ liệu thật.
- **Lớp 3: RA SẢN PHẨM (Output)** — Đóng gói quy trình, đưa vào công việc vào sáng thứ Hai.

### 2.5. Giảng viên & Người hướng dẫn (Instructors)
- Card giảng viên: Ảnh chân dung thực tế, profile, công nghệ áp dụng.
- Giảng viên chính: **Hồ Hoàng Tiến** — Chuyên gia Giải pháp Tự động hoá & Trí tuệ Nhân tạo thực chiến.

### 2.6. Chứng nhận & Cam kết đầu ra (Certificate & Trust)
- Mô phỏng chứng nhận hoàn thành chuẩn nhận diện: Logo tròn trượt 3 lớp màu đặc trưng, số hiệu chứng chỉ chuẩn `MKT_001 · [MÃ HỌC VIÊN]`.

### 2.7. Chân trang (Footer)
- Logo Erasight Edu nằm trang nhã.
- Thông tin liên hệ, chính sách học tập, cam kết chất lượng.
