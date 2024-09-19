const express = require("express");
const cron = require("node-cron");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

const sendNoti = (content) => {
  const pushTitle = express.urlencoded(content.pushTitle);
  const pushText = express.urlencoded(content.pushText);
  axios({
    method: "post", // Hoặc 'get' tùy vào phương thức bạn sử dụng
    url: "https://www.notifymydevice.com/myapplications", // Đường dẫn của bạn
    headers: {
      accept: "*/*",
      "accept-language":
        "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
      "sec-ch-ua":
        '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "x-requested-with": "XMLHttpRequest",
      Referer: "https://www.notifymydevice.com/myapplications",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
    data: `ApiKey=UPDHYSG650SL7BHC2ZU2JBEY1&PushTitle=${pushTitle}&PushText=${pushText}`,
  })
    .then((response) => {
      console.log("Send noti success: ", response.data);
    })
    .catch((error) => {
      console.error("Send noti error: ", error);
    });
};

// Đường dẫn tới file lưu trữ danh sách bài viết
const storagePath = "./articles.json";

// Đọc danh sách bài viết đã lưu trữ
const readStoredArticles = () => {
  if (fs.existsSync(storagePath)) {
    const rawData = fs.readFileSync(storagePath);
    return JSON.parse(rawData).articles || [];
  }
  return [];
};

// Ghi danh sách bài viết mới vào file lưu trữ
const storeArticles = (articles) => {
  fs.writeFileSync(storagePath, JSON.stringify({ articles }, null, 2));
};

// Đường dẫn tới file JSON để lưu danh sách các cron job
const jobsFilePath = "./jobs.json";

// Tải danh sách các job từ file JSON
const loadJobsFromFile = () => {
  if (fs.existsSync(jobsFilePath)) {
    const fileData = fs.readFileSync(jobsFilePath);
    return JSON.parse(fileData);
  }
  return [];
};

// Lưu danh sách các job vào file JSON
const saveJobsToFile = (jobs) => {
  fs.writeFileSync(jobsFilePath, JSON.stringify(jobs, null, 2));
};

// Lưu trữ các job hiện tại
let jobs = loadJobsFromFile();

// Lưu trữ các cron job đã khởi động
let activeCronJobs = {};

// Hàm kiểm tra bài viết mới
const checkForNewArticles = async (job) => {
  try {
    const { data } = await axios.get(job.url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36",
        Referer: job.url,
      },
    });
    const $ = cheerio.load(data);

    // Lấy danh sách bài viết từ query selector
    const currentArticles = $(job.querySelector)
      .map((_, element) => ({
        title: $(element).find("a").text().trim(),
        link: $(element).find("a").attr("href"),
      }))
      .get();

    // Đọc danh sách bài viết đã lưu
    const storedArticles = readStoredArticles();

    // So sánh và tìm bài viết mới
    const newArticles = currentArticles.filter(
      (currentArticle) =>
        !storedArticles.some(
          (storedArticle) => storedArticle.link === currentArticle.link
        )
    );

    // Nếu có bài viết mới
    if (newArticles.length > 0) {
      console.log(`Có ${newArticles.length} bài viết mới:`);
      newArticles.forEach((article) => console.log(article.title));

      // Gửi thông báo tới điện thoại (có thể dùng push notification, email, hoặc webhook)
      sendNoti({
        pushTitle: `Có ${newArticles.length} bài viết mới:`,
        pushText: newArticles.map((art) => art.title).join("; "),
      });

      // Cập nhật lại danh sách bài viết
      storeArticles(currentArticles);
    } else {
      console.log("Không có bài viết mới.");
    }
  } catch (error) {
    console.error(`Có lỗi xảy ra khi kiểm tra job ${job.id}:`, error);
  }
};

// Khởi tạo cron job
const createCronJob = (job) => {
  return cron.schedule(job.cronValue, () => checkForNewArticles(job));
};

// Khởi động tất cả các job từ file JSON
const startAllJobs = () => {
  jobs.forEach((job) => {
    if (!activeCronJobs[job.id]) {
      activeCronJobs[job.id] = createCronJob(job);
      console.log(`Job ${job.id} đã được khởi động.`);
    }
  });
};

startAllJobs(); // Khởi động tất cả các job khi server khởi động

// API: Lấy danh sách các job
app.get("/api/jobs", (req, res) => {
  res.json(jobs);
});

// API: Thêm một job mới
app.post("/api/jobs", (req, res) => {
  const { url, querySelector, cronValue } = req.body;
  const newJob = {
    id: uuidv4(),
    url,
    querySelector,
    cronValue,
  };
  jobs.push(newJob);
  saveJobsToFile(jobs);
  // Tạo và khởi động cron job
  activeCronJobs[newJob.id] = createCronJob(newJob);
  res.status(201).json(newJob);
});

// API: Sửa một job
app.put("/api/jobs/:id", (req, res) => {
  const { id } = req.params;
  const { url, querySelector, cronValue } = req.body;
  const jobIndex = jobs.findIndex((job) => job.id === id);

  if (jobIndex > -1) {
    // Dừng job hiện tại nếu đang chạy
    if (activeCronJobs[id]) {
      activeCronJobs[id].stop();
      delete activeCronJobs[id];
    }

    // Cập nhật thông tin job
    jobs[jobIndex] = { id, url, querySelector, cronValue };
    saveJobsToFile(jobs);

    // Tạo và khởi động cron job mới
    activeCronJobs[id] = createCronJob(jobs[jobIndex]);
    res.json(jobs[jobIndex]);
  } else {
    res.status(404).json({ message: "Job không tồn tại" });
  }
});

// API: Xóa một job
app.delete("/api/jobs/:id", (req, res) => {
  const { id } = req.params;
  const jobIndex = jobs.findIndex((job) => job.id === id);

  if (jobIndex > -1) {
    // Dừng job nếu đang chạy
    if (activeCronJobs[id]) {
      activeCronJobs[id].stop();
      delete activeCronJobs[id];
    }

    // Xóa job khỏi danh sách
    jobs.splice(jobIndex, 1);
    saveJobsToFile(jobs);
    res.json({ message: "Job đã được xóa" });
  } else {
    res.status(404).json({ message: "Job không tồn tại" });
  }
});

// API: Bắt đầu một job
app.post("/api/jobs/:id/start", (req, res) => {
  const { id } = req.params;
  const job = jobs.find((job) => job.id === id);

  if (job) {
    if (!activeCronJobs[id]) {
      activeCronJobs[id] = createCronJob(job);
      res.json({ message: "Job đã được khởi động" });
    } else {
      res.status(400).json({ message: "Job đang chạy" });
    }
  } else {
    res.status(404).json({ message: "Job không tồn tại" });
  }
});

// API: Dừng một job
app.post("/api/jobs/:id/stop", (req, res) => {
  const { id } = req.params;

  if (activeCronJobs[id]) {
    activeCronJobs[id].stop();
    delete activeCronJobs[id];
    res.json({ message: "Job đã được dừng" });
  } else {
    res.status(404).json({ message: "Job không tồn tại hoặc không đang chạy" });
  }
});

// Khởi động server
app.listen(port, () => {
  console.log(`Server đang chạy tại http://localhost:${port}`);
});
