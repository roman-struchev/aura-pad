# Google Tasks: Настройка OAuth в Google Cloud Console

Данная инструкция описывает, как настроить OAuth клиент в Google Cloud Console для работы с Google Tasks в AuraPad, чтобы:
1. Авторизация работала «в один клик» через браузер.
2. **Токены не протухали каждые 7 дней** (решение проблемы `invalid_grant` / истечения refresh-токена).

---

## Почему раньше токены протухали каждые 7 дней?

В Google Cloud Console для OAuth-экрана есть два статуса:
- **Testing (Тестирование)**: Google принудительно ограничивает срок жизни Refresh Token **7 днями**. Ровно через неделю токен становится недействительным, и требуется повторный вход.
- **In production (В рабочей версии)**: Refresh Token действует бессрочно (пока пользователь явно не отзовет доступ в аккаунте Google или если токен не используется более 6 месяцев).

Для личного приложения или утилиты переключение в **In production** не требует платной верификации от Google (достаточно подтвердить публикацию, на экране входа в браузере Google покажет предупреждение *"Google haven't verified this app"*, которое пропускается нажатием *Advanced → Go to app (unsafe)*).

---

## Настройка в Google Cloud Console

Вы можете использовать существующий проект (например, `aura-notes-511100`, где уже настроен экран согласия) либо создать новый.

### Шаг 1. Откройте проект
1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/).
2. В верхнем селекторе выберите проект (например, **`aura-notes-511100`**).

### Шаг 2. Включите Google Tasks API
1. В левом меню перейдите в **APIs & Services** → **Enabled APIs & services** (или **Library**).
2. Нажмите **+ ENABLE APIS AND SERVICES**.
3. В поиске введите `Google Tasks API`.
4. Нажмите на карточку **Google Tasks API** и нажмите кнопку **Enable** (если ещё не включен).

### Шаг 3. Проверьте OAuth Consent Screen (Экран согласия)
1. В левом меню перейдите в **APIs & Services** → **OAuth consent screen** (Экран согласия OAuth).
2. Проверьте статус публикации (**Publishing status**):
   - Если статус **Testing**: нажмите кнопку **Publish App** (Опубликовать приложение) и подтвердите переход в **In production**.
   - *Важно*: Если статус **In production**, токены больше не будут истекать через 7 дней.
3. Проверьте Scopes (Области доступа):
   - Нажмите **Edit App** (или перейдите в раздел **Data access / Scopes**).
   - Убедитесь, что добавлен scope `https://www.googleapis.com/auth/tasks` (полный доступ к чтению и изменению задач).
   - Если добавлены только `tasks.readonly`, приложение не сможет создавать и завершать задачи.

### Шаг 4. Создайте OAuth Client ID типа «Desktop app»
1. В левом меню перейдите в **APIs & Services** → **Credentials** (Учетные данные).
2. Вверху нажмите **+ CREATE CREDENTIALS** → **OAuth client ID**.
3. В выпадающем списке **Application type** обязательно выберите:
   - **Desktop app** (Классическое приложение / Приложение для ПК).
   *(Не Web application и не Chrome extension! Desktop-клиенты поддерживают PKCE и loopback-редирект на `127.0.0.1:<порт>` без необходимости фиксировать порт).*
4. В поле **Name** укажите понятное имя, например: `AuraPad Desktop`.
5. Нажмите **Create**.
6. Появится модальное окно с:
   - **Client ID** (вида `xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com`)
   - **Client Secret** (вида `GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx`)

---

## Как вшить ключи в AuraPad

По стандарту **RFC 8252** (OAuth 2.0 for Native Apps) и официальной документации Google:
- В desktop-приложениях Client Secret не является секретом (любой пользователь может декомпилировать клиент).
- Безопасность обеспечивается алгоритмом **PKCE (RFC 7636)** с SHA-256 challenge и loopback-редиректом на локальный сокет `127.0.0.1`.
- Зашивание Client ID / Secret прямо в бинарник является стандартной практикой для desktop-утилит (так делают, например, rclone, Thunderbird и др.).

Для добавления ключей:
1. Откройте файл `src/main/googleTasks.ts`.
2. Вставьте полученные данные в константы:
   ```ts
   const EMBEDDED_CLIENT_ID = 'ВАШ_CLIENT_ID.apps.googleusercontent.com'
   const EMBEDDED_CLIENT_SECRET = 'ВАШ_CLIENT_SECRET'
   ```
   *(Также поддерживаются переменные окружения `AURAPAD_GTASKS_CLIENT_ID` и `AURAPAD_GTASKS_CLIENT_SECRET`).*
3. Соберите или запустите приложение (`npm run dev` или сборка релиза).
4. Теперь при открытии вкладки Tasks или окна настроек кнопка **Add Google Account** доступна сразу в 1 клик, без необходимости ввода настроек пользователем.

---

## Процесс входа для пользователя
1. Нажмите **Add Google Account**.
2. В браузере по умолчанию откроется страница входа Google.
3. Выберите нужный аккаунт Google.
4. Если появится экран *«Google hasn't verified this app»* (это нормально для личных проектов):
   - Нажмите ссылку **Advanced** (Дополнительно).
   - Нажмите **Go to ... (unsafe)** (Перейти на страницу ...).
5. Разрешите доступ к Google Tasks.
6. Браузер перенаправит на локальный порт `http://127.0.0.1:<port>`, AuraPad автоматически подхватит авторизацию, фокус вернется в окно приложения, и аккаунт отобразится как подключенный.
