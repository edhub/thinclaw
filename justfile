set dotenv-load

default:
    @just -l

deploy:
    pnpm i && pnpm run build
    rsync -r --delete build/ root@39.108.244.135:/var/www/html/claw

dev:
    pnpm i && pnpm run dev
