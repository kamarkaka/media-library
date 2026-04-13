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
  const { username, password } = req.body;

  if (
    username === config.authUsername &&
    config.authPasswordHash &&
    bcrypt.compareSync(password, config.authPasswordHash)
  ) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.redirect('/');
  }

  res.render('login', { title: 'Login', error: 'Invalid username or password' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

export default router;
