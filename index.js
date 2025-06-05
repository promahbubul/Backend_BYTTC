const express = require("express");
const cors = require("cors");
const colors = require("colors");
const mogran = require("morgan");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const dotenv = require("dotenv");
const SSLCommerzPayment = require("sslcommerz-lts");
const morgan = require("morgan");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const moment = require("moment");

const app = express();
dotenv.config();
const PORT = process.env.PORT || 4300;
const store_id = process.env.STORE_ID;
const store_passwd = process.env.STORE_PASSWD;
const dbUri = process.env.DB_URI;
// const dbUri = "mongodb://localhost:27017/";
const is_live = false; //true for live, false for sandbox

// Initialize

app.use(express.json());
app.use(cors());
app.use(morgan("dev"));

const client = new MongoClient(dbUri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(200).json({ message: "No token found" });
  }
  const token = authHeader.split(" ")[1];

  try {
    const decode = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decode;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token", status: false });
  }
};

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    const db = client.db("jubo-unnyon");
    const studentCollection = db.collection("students");
    const courseCollection = db.collection("courses");
    const userCollection = db.collection("users");

    // Users
    app.post("/users", async (req, res) => {
      const user = req.body;
      user.type = "user";

      const existUser = await userCollection.findOne({ email: user.email });
      console.log(existUser);
      if (existUser) {
        return res.status(201).json({
          message: "user already exist",
          status: 200,
          success: false,
        });
      }

      const hashPassword = bcrypt.hashSync(
        user.password,
        parseInt(process.env.SALT_ROUND)
      );
      user.password = hashPassword;
      const result = await userCollection.insertOne(user);
      //   const verity = bcrypt.compareSync("myPlaintextPassword", hashPassword);
      //   res.send({hash: hashPassword, verity})

      //     console.log(hashPassword, verity);
      //   const result = await userCollectin.insertOne(user);
      res.status(201).json({
        message: "user created successfully",
        data: result,
        status: 201,
      });
    });

    app.post("/login", async (req, res) => {
      try {
        const user = req.body;
        const findUser = await userCollection.findOne({ email: user.email });

        if (!findUser) {
          res.status(200).json({
            status: false,
            message: "User doesn't exist",
          });
        }
        const matchPassword = bcrypt.compareSync(
          user.password,
          findUser.password
        );
        if (!matchPassword) {
          res.status(200).json({
            status: false,
            message: "password doesn't matched",
          });
        }

        const token = jwt.sign(
          { id: findUser._id, email: findUser.email, type: findUser.type },
          process.env.JWT_SECRET,
          {
            expiresIn: "2h",
          }
        );

        res.status(200).json({
          status: true,
          message: "User login success",
          data: {
            token,
            user: {
              id: findUser._id,
              email: findUser.email,
              type: findUser.type,
            },
          },
        });
      } catch (error) {
        console.log(error);
      }
    });

    app.get("/profile", authMiddleware, async (req, res) => {
      const user = req.user;

      res.status(200).json({
        message: "User login successfully",
        status: true,
        data: {
          email: user.email,
          type: user.type,
        },
      });
    });

    // Student
    app.post("/students", async (req, res) => {
      try {
        const student = req.body;
        const courseId = student.course;
        const query = { _id: new ObjectId(courseId) };
        const course = await courseCollection.findOne(query);
        const studentLength = (await studentCollection.countDocuments()) || 0;
        const transactionID = Date.now();
        const year = moment(transactionID).format("YYYY"); // "22 April 2025"
        const registrationNumber = `${year}${String(studentLength + 1).padStart(
          4,
          "0"
        )}`;
        // res.send(registrationNumber);

        student.registrationNumber = registrationNumber;
        student.course = course;
        const data = {
          total_amount: course?.price,
          currency: "BDT",
          tran_id: transactionID, // use unique tran_id for each api call
          success_url: `http://localhost:${process.env.port}/payment/success/${transactionID}`,
          fail_url: `http://localhost:${process.env.port}/payment/fail/${transactionID}`,
          cancel_url: "http://localhost:3030/cancel",
          ipn_url: "http://localhost:3030/ipn",
          shipping_method: "Online",
          product_name: course?.name,
          product_category: course?.name,
          product_profile: course?.name,
          cus_name: student?.nameEnglish,
          cus_email: student.email,
          cus_add1: student?.village,
          cus_add2: student?.upazila,
          cus_city: student?.district,
          cus_state: "",
          cus_postcode: student?.postCode,
          cus_country: "Bangladesh",
          cus_phone: student.phone,
          cus_fax: "",
          ship_name: student?.nameEnglish,
          ship_add1: student?.village,
          ship_add2: student?.upazila,
          ship_city: student?.district,
          ship_state: "",
          ship_postcode: student?.postCode,
          ship_country: "Bangladesh",
        };

        const sslcz = new SSLCommerzPayment(store_id, store_passwd, is_live);
        sslcz.init(data).then(async (apiResponse) => {
          // Redirect the user to payment gateway

          let GatewayPageURL = apiResponse.GatewayPageURL;
          res.send({ url: GatewayPageURL });
          const result = await studentCollection.insertOne({
            ...student,
            transactionID: transactionID,
            paymentStatus: false,
          });

          // Success Payment
          app.post("/payment/success/:transactionID", async (req, res) => {
            const { transactionID } = req.params;
            const result = await studentCollection.updateOne(
              { transactionID: parseInt(transactionID) },
              {
                $set: {
                  paymentStatus: true,
                },
              }
            );
            if (result?.modifiedCount > 0) {
              res.redirect(`http://localhost:5173/payment/${transactionID}`);
            }
          });
          // Fail Payment
          app.post("/payment/fail/:transactionID", async (req, res) => {
            const { transactionID } = req.params;
            const result = await studentCollection.deleteOne({
              transactionID: parseInt(transactionID),
            });
            if (result.deletedCount > 0) {
              res.redirect(
                `http://localhost:5173/payment-fail/${transactionID}`
              );
            }
          });

          console.log("Redirecting to: ", GatewayPageURL);
        });
      } catch (error) {
        console.log(error);
      }
    });

    app.get("/students", authMiddleware, async (req, res) => {
      try {
        const result = await studentCollection.find().toArray();
        res.status(200).json({
          message: "Student retrieved successfully",
          success: true,
          data: result,
        });
      } catch (error) {
        console.error(error);
        res.status(500).json({
          message: "Something went wrong",
          success: false,
          error: error.message,
        });
      }
    });

    app.get("/students/:transactionID", async (req, res) => {
      const { transactionID } = req.params;
      const result = await studentCollection.findOne({
        transactionID: parseInt(transactionID),
      });
      if (!result) {
        return res.json({
          message: "Student not found",
          success: false,
        });
      }
      res.status(200).json({
        message: "Student registered successfully",
        success: true,
        data: result,
      });
    });

    // Course
    app.post("/courses", authMiddleware, async (req, res) => {
      const student = req.body;
      const result = await courseCollection.insertOne(student);

      res.status(201).json({
        message: "Student registered successfully",
        success: true,
        data: result,
      });
    });
    // app.get("/courses/:id", async (req, res) => {
    //   const courseId = req.params.id;c
    // console.log(req.params)
    // //   const query = new ObjectId({ _id: courseId });
    // //   const result = await studentCollection.findOne(query);
    // //   res.status(201).json({
    // //     message: "Course retrived successfully",
    // //     success: true,
    // //     data: result,
    // //   });
    // });
    app.get("/courses", async (req, res) => {
      const result = await courseCollection.find().toArray();
      res.status(200).json({
        message: "Course retrived successfully",
        success: true,
        data: result,
      });
    });

    app.get("/courses/:courseId", async (req, res) => {
      const { courseId } = req.params;
      const course = await courseCollection.findOne({
        _id: new ObjectId(courseId),
      });
      res.status(200).json({
        message: "Course retrived successfully",
        success: true,
        data: course,
      });
    });
    app.delete("/courses/:courseId", authMiddleware, async (req, res) => {
      const { courseId } = req.params;
      const course = await courseCollection.deleteOne({
        _id: new ObjectId(courseId),
      });
      res.status(200).json({
        message: "Course deleted successfully",
        success: true,
        data: course,
      });
    });
    app.put("/courses/:courseId", authMiddleware, async (req, res) => {
      const { courseId } = req.params;
      const course = req.body;

      const result = await courseCollection.updateOne(
        {
          _id: new ObjectId(courseId),
        },
        {
          $set: {
            ...course,
          },
        }
      );
      res.status(200).json({
        message: "Course update successfully",
        success: true,
        data: result,
      });
    });

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.json({
    success: true,
    message: "Server working",
  });
});

app.listen(PORT, () => {
  console.log("Server::".bgGreen, `http://localhost:${PORT}`);
});
