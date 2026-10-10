// The References page: the sources behind every procedure in the tool,
// grouped by the page that uses them, so that a reader can follow any
// method back to where it is defined and justified. This is the only page
// that names a book, a paper, or a software package.

/** The page's hash id. */
export const id = 'references';
/** The page's title. */
export const title = 'References';

const GROUPS = [
  ['General', [
    'P. McCullagh and J. A. Nelder, <i>Generalized Linear Models</i>, 2nd ed. (Chapman and Hall, 1989): the families, the links, iteratively reweighted least squares, the deviance, and the residuals.',
    'A. J. Dobson and A. G. Barnett, <i>An Introduction to Generalized Linear Models</i>, 4th ed. (CRC Press, 2018): a shorter route into the same material.',
    'J. Fox, <i>Applied Regression Analysis and Generalized Linear Models</i>, 3rd ed. (Sage, 2016): the design matrix, contrasts, and interactions as this tool builds them.'
  ]],
  ['Model', [
    'J. A. Nelder and R. W. M. Wedderburn, “Generalized linear models,” <i>Journal of the Royal Statistical Society, Series A</i> 135 (1972) 370–384: the paper that defined the class and its fitting.',
    'W. N. Venables and B. D. Ripley, <i>Modern Applied Statistics with S</i>, 4th ed. (Springer, 2002): the negative binomial fit with θ estimated and the proportional-odds model, as <code>MASS::glm.nb</code> and <code>MASS::polr</code> carry them out.',
    'F. Cribari-Neto and A. Zeileis, “Beta regression in R,” <i>Journal of Statistical Software</i> 34 (2010) 1–24; S. Ferrari and F. Cribari-Neto, “Beta regression for modelling rates and proportions,” <i>Journal of Applied Statistics</i> 31 (2004) 799–815.',
    'P. McCullagh, “Regression models for ordinal data,” <i>Journal of the Royal Statistical Society, Series B</i> 42 (1980) 109–142: the cumulative-link model.'
  ]],
  ['Random effects', [
    'D. Bates, M. Mächler, B. Bolker, and S. Walker, “Fitting linear mixed-effects models using lme4,” <i>Journal of Statistical Software</i> 67 (2015) 1–48: the penalized least-squares inner loop, the profiled deviance, and the Laplace approximation this tool follows.',
    'M. E. Brooks, K. Kristensen, K. J. van Benthem, A. Magnusson, C. W. Berg, A. Nielsen, H. J. Skaug, M. Mächler, and B. M. Bolker, “glmmTMB balances speed and flexibility among packages for zero-inflated generalized linear mixed modeling,” <i>The R Journal</i> 9 (2017) 378–400: the package the beta mixed model exports to.',
    'B. M. Bolker, M. E. Brooks, C. J. Clark, S. W. Geange, J. R. Poulsen, M. H. H. Stevens, and J.-S. S. White, “Generalized linear mixed models: a practical guide for ecology and evolution,” <i>Trends in Ecology and Evolution</i> 24 (2009) 127–135: when a random effect is called for, how many groups it needs, and what the observation-level random effect does for overdispersion.',
    'X. A. Harrison, “Using observation-level random effects to model overdispersion in count data in ecology and evolution,” <i>PeerJ</i> 2 (2014) e616.'
  ]],
  ['Diagnostics', [
    'P. K. Dunn and G. K. Smyth, “Randomized quantile residuals,” <i>Journal of Computational and Graphical Statistics</i> 5 (1996) 236–244: the residuals whose normal quantile–quantile plot reads the same way for every family.',
    'F. Hartig, <i>DHARMa: residual diagnostics for hierarchical (multi-level / mixed) regression models</i>, R package (2022): the simulation-based form of the same residuals for mixed models.',
    'S. S. Shapiro and M. B. Wilk, “An analysis of variance test for normality (complete samples),” <i>Biometrika</i> 52 (1965) 591–611; P. Royston, “A remark on algorithm AS 181: the W-test for normality,” <i>Applied Statistics</i> 44 (1995) 547–551.',
    'R. D. Cook, “Detection of influential observation in linear regression,” <i>Technometrics</i> 19 (1977) 15–18.'
  ]],
  ['Predict', [
    'R. V. Lenth, <i>emmeans: estimated marginal means, aka least-squares means</i>, R package (2024): the marginal means and their pairwise comparisons as this tool forms them.',
    'J. W. Tukey, “Comparing individual means in the analysis of variance,” <i>Biometrics</i> 5 (1949) 99–114: the studentized-range correction on the pairwise differences.'
  ]],
  ['Compare', [
    'H. Akaike, “A new look at the statistical model identification,” <i>IEEE Transactions on Automatic Control</i> 19 (1974) 716–723; G. Schwarz, “Estimating the dimension of a model,” <i>Annals of Statistics</i> 6 (1978) 461–464.',
    'K. P. Burnham and D. R. Anderson, <i>Model Selection and Multimodel Inference</i>, 2nd ed. (Springer, 2002): comparing a set of candidate models by information criteria rather than searching for one.'
  ]],
  ['Tests as models', [
    'J. K. Lindeløv, “Common statistical tests are linear models (or: how to teach stats),” online (2019): the correspondence between the classical tests and the linear models this page draws.',
    'A. Agresti, <i>Categorical Data Analysis</i>, 3rd ed. (Wiley, 2013): the log-linear model behind the chi-square test of independence and the logistic model behind the comparison of two proportions.'
  ]]
];

/**
 * Renders the page into its section.
 * @param {HTMLElement} root
 */
export function render(root) {
  root.innerHTML =
    '<h2>' + title + '</h2>' +
    '<p class="lede">The sources behind the procedures on each page. The books under General cover nearly every page and are where a reader new to generalized linear models should start; the papers are where each procedure was defined or justified, and the package references name what each exported script calls.</p>' +
    GROUPS.map(([name, items]) =>
      '<div class="sec"><div class="sec-hd">' + name + '</div><ul class="ref-list">' + items.map(t => '<li>' + t + '</li>').join('') + '</ul></div>').join('');
}

/** Called each time the page is shown. */
export function onShow() {}

export default { id, title, render, onShow };
