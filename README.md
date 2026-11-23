<div align="center">

# Project: Hive Mind
### Web Engineering Simulation / Симуляція Мурашиної Колонії

[**🇬🇧 English**](#-project-hive-mind-web-engineering-simulation) | [**🇺🇦 Українська**](#-проєкт-hive-mind-симуляція-для-веб-інженерів)

</div>

---

## 🇬🇧 Project: Hive Mind (Web Engineering Simulation)

> **Context:** This project is part of the "Web Engineering" course for students with a strong C++ background.
> **Goal:** Build a high-performance turn-based simulation of an Ant Colony from scratch.

### 🎯 Project Objective
Create a browser-based simulation where autonomous agents ("Ants") explore a procedurally generated map, gather resources ("Food"), and compete for survival.

**Key Challenge:** The focus is **NOT** on using frameworks (React/Vue/Angular are prohibited). The focus is on understanding the **Runtime Environment**, **Memory Management**, **Asynchronous Event Loop**, and **Algorithmic Efficiency**.

---

### 🛠 Tech Stack & Constraints

#### 1. Core Technology
* **Language:** Vanilla JavaScript (ES6+).
* **Rendering:** HTML5 Canvas API (preferred for performance) or DOM Manipulation (for UI).
* **Build Tool:** Vite (Vanilla template) — for HMR and Module bundling.
* **Testing:** Vitest (optional).

#### 2. Engineering Constraints
* **No UI Frameworks:** We build the "Virtual DOM" logic manually if needed.
* **Performance First:** The simulation must handle 1000+ entities without dropping below 60 FPS.
* **Typed Architecture:** Use JSDoc or TypeScript (strict mode) to enforce types, mimicking C++ strict typing.

---

### 🏗 Architecture Overview

The application follows a strict **Model-View-Controller (MVC)** or **Entity-Component-System (ECS)** pattern.

#### 1. Data Layer (The Memory)
* **Map:** A 2D Grid (Matrix), similar to `int map[height][width]`.
* **State:** A central State Object that holds the "World Truth".
* **Storage:** `localStorage` is used to persist state (Simulation Save/Load).

#### 2. Logic Layer (The CPU)
* **Game Loop:** A `requestAnimationFrame` loop that decouples **Update()** (Logic) from **Draw()** (Rendering).
* **Bot Logic:** Pure functions that take `View` (local surroundings) and return an `Action`.
    * *Challenge:* Ants must use "Pheromones" (writing data to map cells) to communicate. Global communication between agents is prohibited (Simulated "Fog of War").

#### 3. Presentation Layer (The GPU)
* **Renderer:** A class responsible for translating the Matrix State into pixel data on `<canvas>`.

---

### 🤖 Rules for AI Assistant (Cursor/Copilot)

**If you are assisting with this project, you MUST adhere to these rules:**

1.  **C++ Analogies:** When explaining JS concepts, compare them to C++.
    * *Example:* "In JS, objects are references, similar to `std::shared_ptr` in C++. They are allocated on the Heap."
    * *Example:* "Using `push` on an Array can trigger a reallocation, similar to `std::vector::push_back`."
2.  **No Magic Code:** Do not generate complex algorithms (like A*) without first explaining the heuristic and data structures involved.
3.  **Memory Awareness:** Warn about closures and event listeners that might cause Memory Leaks. Treat the Browser Memory as a finite resource.
4.  **Security:** When discussing input handling, mention XSS risks even if not directly applicable to a game (educational context).
5.  **Step-by-Step:** Do not generate the entire `GameLoop` at once. Build it iteratively with the user.

---

### 🚀 Getting Started

1.  Initialize project (if starting from scratch): `npm create vite@latest hive-mind -- --template vanilla`
2.  Install dependencies: `npm install`
3.  Start dev server: `npm run dev`

**Without Node.js:** open `standalone/hive-mind.html` with a double-click. It is the whole game bundled into one file (no server needed). After changing anything in `src/`, rebuild it with `py tools/build_standalone.py` (Python 3).

**Controls:** `Space` pause · `S` save · `L` load · `N` new map · `?seed=42` in the URL replays the same map.

---
---

## 🇺🇦 Проєкт: Hive Mind (Симуляція для Веб-Інженерів)

> **Контекст:** Цей проєкт є частиною курсу "Web Engineering" для студентів із сильним бекграундом у C++.
> **Мета:** Створити високопродуктивну покрокову симуляцію мурашиної колонії з нуля.

### 🎯 Мета проєкту
Створити браузерну симуляцію, де автономні агенти ("Мурахи") досліджують процедурно згенеровану карту, збирають ресурси ("Їжа") та змагаються за виживання.

**Головний виклик:** Фокус **НЕ** на використанні фреймворків (React/Vue/Angular заборонені). Фокус на розумінні **Середовища виконання (Runtime)**, **Управління пам'яттю**, **Асинхронного Event Loop** та **Алгоритмічної ефективності**.

---

### 🛠 Технологічний стек та Обмеження

#### 1. Основні технології
* **Мова:** Чистий JavaScript (Vanilla JS, ES6+).
* **Рендеринг:** HTML5 Canvas API (для швидкодії) або DOM (для інтерфейсу).
* **Збірка:** Vite (Vanilla template) — для HMR та бандлінгу модулів.
* **Тестування:** Vitest (опціонально).

#### 2. Інженерні обмеження
* **Жодних UI Фреймворків:** Якщо нам потрібен Virtual DOM, ми пишемо його самі.
* **Performance First:** Симуляція має підтримувати 1000+ сутностей, не падаючи нижче 60 FPS.
* **Типізована архітектура:** Використання JSDoc або TypeScript (strict mode) для суворої типізації, імітуючи підхід C++.

---

### 🏗 Архітектурний огляд

Додаток слідує патерну **Model-View-Controller (MVC)** або **Entity-Component-System (ECS)**.

#### 1. Шар Даних (Пам'ять)
* **Карта:** 2D Сітка (Матриця), схожа на `int map[height][width]`.
* **State:** Центральний об'єкт стану, що тримає "Істину Світу".
* **Storage:** `localStorage` використовується для збереження стану (Save/Load).

#### 2. Шар Логіки (CPU)
* **Game Loop:** Цикл на базі `requestAnimationFrame`, що відділяє **Update()** (обчислення) від **Draw()** (малювання).
* **Логіка Ботів:** Чисті функції (Pure Functions), які приймають `View` (що бачить мураха) і повертають `Action` (дію).
    * *Челендж:* Мурахи використовують "Феромони" (запис даних у клітинки карти) для спілкування. Глобальна комунікація між агентами заборонена ("Туман війни").

#### 3. Шар Презентації (GPU)
* **Renderer:** Клас, відповідальний за перетворення матриці стану в пікселі на `<canvas>`.

---

### 🤖 Правила для ШІ-асистента (Cursor/Copilot)

**Якщо ви (ШІ) допомагаєте з цим проєктом, ви ЗОБОВ'ЯЗАНІ дотримуватись цих правил:**

1.  **Аналогії з C++:** Пояснюючи концепти JS, порівнюй їх з C++.
    * *Приклад:* "В JS об'єкти — це посилання (references), схожі на `std::shared_ptr` в C++. Вони виділяються в Heap (Купі)."
    * *Приклад:* "Використання `push` для масиву може викликати реалокацію, схожу на `std::vector::push_back`."
2.  **Ніякого "Магічного Коду":** Не генеруй складні алгоритми (як A*), не пояснивши спочатку евристику та структури даних.
3.  **Контроль пам'яті:** Попереджай про замикання (closures) та слухачі подій (event listeners), які можуть викликати витоки пам'яті (Memory Leaks). Стався до пам'яті браузера як до вичерпного ресурсу.
4.  **Безпека:** Обговорюючи обробку вводу, згадуй ризики XSS, навіть якщо це навчальна гра.
5.  **Покроковість:** Не генеруй весь `GameLoop` за раз. Будуй його ітеративно разом з користувачем.

---

### 🚀 Як почати (Getting Started)

1.  Ініціалізація (якщо з нуля): `npm create vite@latest hive-mind -- --template vanilla`
2.  Встановлення залежностей: `npm install`
3.  Запуск сервера розробки: `npm run dev`

**Без Node.js:** відкрийте `standalone/hive-mind.html` подвійним кліком. Це вся гра, зібрана в один файл (сервер не потрібен). Після змін у `src/` перезберіть його: `py tools/build_standalone.py` (Python 3).

**Керування:** `Space` пауза · `S` зберегти · `L` завантажити · `N` нова карта · `?seed=42` в адресі відтворює ту саму карту.
