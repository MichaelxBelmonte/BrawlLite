FROM node:18-alpine

WORKDIR /app

# Copia package.json e package-lock.json
COPY package*.json ./

# Installa le dipendenze
RUN npm install

# Copia il resto dei file
COPY . .

# Espone la porta 3000
EXPOSE 3000

# Avvia il server
CMD ["node", "server.js"] 