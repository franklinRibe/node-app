FROM node:8 as builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

FROM node:8
WORKDIR /app

COPY --from=builder /app ./

EXPOSE 3000
CMD ["npm", "start"]