FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Kolkata PORT=3000
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
