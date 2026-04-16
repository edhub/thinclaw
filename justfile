set dotenv-load

default:
    @just -l

deploy:
    bun i && bun run build
    rsync -r --delete build/ ali44:/var/www/claw/public

dev:
    bun i && bun run dev
