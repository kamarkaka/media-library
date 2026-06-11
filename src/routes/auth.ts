import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { config } from '../config';

const router = Router();

router.get('/login', (req, res) => {
  if (req.session?.authenticated) {
    return res.redirect('/');
  }
  res.render('login', { title: 'Login', error: null });
});

router.post('/login', (req, res) => {
  // The single owner account is always 'admin' (config.authUsername); only the password is entered.
  const { password } = req.body;

  if (
    config.authPasswordHash &&
    bcrypt.compareSync(password, config.authPasswordHash)
  ) {
    req.session.authenticated = true;
    return res.redirect('/');
  }

  res.render('login', { title: 'Login', error: 'Invalid password' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

export default router;
