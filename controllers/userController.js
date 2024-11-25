import userModel from '../models/userModel.js';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import Stripe from 'stripe';
import transactionModel from '../models/transactionModel.js';

const registerUser = async (req, res) => {
    try {
        const {name, email, password} = req.body;

        if (!name || !email || !password) {
            return res.json({success:false, message: 'Missing Details'})
        }

        const salt = await bcrypt.genSalt(10)
        const hashedPassword = await bcrypt.hash(password, salt)

        const userData = {
            name, 
            email, 
            password: hashedPassword
        }

        const newUser = new userModel(userData)
        const user = await newUser.save()

        const token = jwt.sign({id: user._id}, process.env.JWT_SECRET)

        res.json({success:true, token, user: {name: user.name}})

    } catch (error) {
        console.log(error)
        res.json({success: false, message: error.message})
    }
}

const loginUser = async (req, res) => {
    try {
        const {email, password} = req.body;
        const user = await userModel.findOne({email})

        if (!user) {
           return res.json({success:false, message: 'User does not exist'})
        }
        const isMatch = await bcrypt.compare(password, user.password)

        if (isMatch) {
            const token = jwt.sign({id: user._id}, process.env.JWT_SECRET)

            res.json({success:true, token, user: {name: user.name}})
        } else {
            return res.json({success:false, message: 'Invalid creditials'})
        }
    } catch (error) {
        console.log(error)
        res.json({success: false, message: error.message})
    }
}

const userCredits = async (req, res) => {
    try {
        const {userId} = req.body

        const user = await userModel.findById(userId)
        res.json({success: true, credits: user.creditBalance, 
            user: {name: user.name} })
               
    } catch (error) {
        console.log(error.message)
        res.json({ success: false, message: error.message })
    }
}

const stripePayInstance = new Stripe(process.env.STRIPE_KEY_SECRET);

const stripePay = async (req, res) => {
    try {
        const { userId, planId } = req.body;

        if (!userId || !planId) {
            return res.json({ success: false, message: 'Missing Details' });
        }

        const userData = await userModel.findById(userId);

        let credits, plan, amount;

        switch (planId) {
            case 'Basic':
                plan = 'Basic';
                credits = 100;
                amount = 10;
                break;
            case 'Advanced':
                plan = 'Advanced';
                credits = 500;
                amount = 50;
                break;
            case 'Business':
                plan = 'Business';
                credits = 5000;
                amount = 250;
                break;
            default:
                return res.json({ success: false, message: 'Plan not found' });
        }

        const transactionData = {
            userId,
            plan,
            amount,
            credits,
            date: Date.now(),
        };

        const newTransaction = await transactionModel.create(transactionData);

        // Create a PaymentIntent
        const paymentIntent = await stripePayInstance.paymentIntents.create({
            amount: amount * 100, // Stripe works with cents
            currency: process.env.CURRENCY || 'usd',
            metadata: {
                transactionId: newTransaction._id.toString(),
                userId: userId,
            },
        });

        res.json({
            success: true,
            clientSecret: paymentIntent.client_secret,
        });
    } catch (error) {
        console.log(error);
        res.json({ success: false, message: error.message });
    }
};

const verifyStripePay = async (req, res) => {
    try {
        const { id } = req.body; // PaymentIntent ID

        // Retrieve the PaymentIntent from Stripe
        const paymentIntent = await stripePayInstance.paymentIntents.retrieve(id);

        if (paymentIntent.status === 'succeeded') {
            const transactionData = await transactionModel.findById(paymentIntent.metadata.transactionId);

            if (!transactionData) {
                return res.json({ success: false, message: 'Transaction not found' });
            }

            const userData = await userModel.findById(transactionData.userId);

            if (!userData) {
                return res.json({ success: false, message: 'User not found' });
            }

            // Update user's credit balance
            const creditBalance = userData.creditBalance + transactionData.credits;
            await userModel.findByIdAndUpdate(userData._id, { creditBalance });

            // Mark transaction as paid
            await transactionModel.findByIdAndUpdate(transactionData._id, { payment: true });

            return res.json({ success: true, message: 'Credits Added' });
        } else {
            return res.json({ success: false, message: 'Payment not completed' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: error.message });
    };
}

export {registerUser, loginUser, userCredits, stripePay, verifyStripePay}
