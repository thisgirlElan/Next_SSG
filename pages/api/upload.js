// Next.js API route support: https://nextjs.org/docs/api-routes/introduction

import { createReadStream } from 'fs';
import path from 'path';
import formidable from "./lib/formidable-serverless";
import { Storage } from '@google-cloud/storage';

const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
const keyFilePath = JSON.parse(process.env.GOOGLE_CLOUD_KEY);

export const config = {
  api: {
    bodyParser: false
  }
}

export default async function handler(req, res) {
  const storage = new Storage({
    credentials: {
      client_email: keyFilePath.client_email,
      private_key: keyFilePath.private_key.replace(/\\n/g, "\n"),
    },
    projectId: projectId,
  });

  const nextSsgBucket = storage.bucket('next_ssg');

  const data = await new Promise((resolve, reject) => {
    const form = new formidable.IncomingForm();
    form.keepExtensions = true;
    form.parse(req, (err, fields, files) => {
      if (err) {
        reject(err)
      }
      resolve({ fields, files })
    });
  });

  const file = data.files.file;
  try {
    const blob = nextSsgBucket.file(file.originalFilename);

    createReadStream(file.filepath)
      .pipe(blob.createWriteStream(file.originalFilename, file.mimetype))
      .on("finish", async () => {
        res.status(200).json("File upload complete")
      })
      .on("error", (err) => {
        res.status(500).send({
          message: err.message
        });
      })

    const blobStream = blob.createWriteStream({
      resumable: false
    });

    blobStream.on("error", (err) => {
      res.status(500).send({ message: err.message });
    });

    blobStream.on("finish", async () => {
      const publicURL = `https://storage.googleapis.com/${nextSsgBucket.name}/${blob.name}`;
      try {
        await blob.makePublic();
      } catch {
        return res.status(500).send({
          message: `Uploaded the file successfully: ${file.newFilename}, but public access is denied!`,
          url: publicURL,
        });
      }

      res.status(200).send({
        message: "Uploaded the file successfully: " + file.newFilename,
        url: publicURL,
      });
    });
    blobStream.end();
  } catch (err) {
    if (err == "LIMIT_FILE_SIZE") {
      return res.status(500).send({
        message: "File size cannot be larger than 25MB!",
      });
    }

    res.status(500).send({
      message: `Could not upload the file: ${file.newFilename}. ${err}`,
    });

  }
  res.status(200).json({ message: "success" });
}

