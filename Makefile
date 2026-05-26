.PHONY: dev build preview clean install

# Local development server with hot reload
dev:
	npx vitepress dev --port 5173 --open

# Production build
build:
	npx vitepress build

# Preview production build locally
preview: build
	npx vitepress preview --port 4173 --open

# Install dependencies
install:
	npm install

# Clean build artifacts
clean:
	rm -rf .vitepress/dist .vitepress/cache
