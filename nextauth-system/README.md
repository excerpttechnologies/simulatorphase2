# Next.js 15 Auth System

Production-ready authentication with Next.js 15, MongoDB, JWT, and Tailwind CSS.

## Quick Start

```bash
cd nextauth-system
npm install
cp .env.local .env.local   # edit your values
npm run dev                # runs on http://localhost:3001
```

## Environment Variables

Edit `.env.local`:

```env
MONGODB_URI=mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/authdb
JWT_SECRET=your_super_secret_key_min_32_chars
NEXTAUTH_URL=http://localhost:3001
NODE_ENV=development
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your@gmail.com
EMAIL_PASS=your_app_password
EMAIL_FROM=noreply@yourdomain.com
```

## Pages

| Route | Description |
|-------|-------------|
| `/login` | Sign in |
| `/register` | Create account |
| `/forgot-password` | Request reset email |
| `/reset-password?token=...` | Set new password |
| `/dashboard` | Protected home |
| `/profile` | Change password |
| `/admin/users` | Admin: manage users |

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/register` | Register |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET  | `/api/auth/me` | Current user |
| POST | `/api/auth/forgot-password` | Send reset email |
| POST | `/api/auth/reset-password` | Reset password |
| POST | `/api/auth/change-password` | Change password |
| GET  | `/api/admin/users` | List users (admin) |
| PATCH | `/api/admin/users/:id` | Toggle active (admin) |
| DELETE | `/api/admin/users/:id` | Delete user (admin) |

## Create First Admin

In MongoDB Atlas, find your user document and set `role: "admin"`.

## Production Deployment (PM2 + Nginx)

```bash
npm run build
pm2 start npm --name "auth-system" -- start
```

Nginx config:
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Security Features

- bcryptjs password hashing (12 rounds)
- JWT in HTTP-only cookies (7 day expiry)
- Middleware-based route protection
- Role-based access control (user / admin)
- Input validation with Zod
- Email enumeration prevention
- Secure + SameSite cookie flags in production
