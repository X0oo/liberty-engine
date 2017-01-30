'use strict';

const express = require('express');
const router = express.Router();
const { sequelize, Article, Namespace } = require(global.rootdir + '/models');
const Response = require(global.rootdir + '/src/responses');

router.get('/',
  (req, res, next) => {
    let limit = Number(req.query.limit);
    if (!limit) {
      limit = 10;
    }
    if (limit > 100) {
      return new Response.BadRequest().send(res);
    }
    return Promise.resolve()
    .then(() => {
      if (req.query.random === 'true' || req.query.random === '1') {
        return Article.findRandomly({ limit });
      } else {
        return Article.findAll({ limit });
      }
    })
    .then((articles) => {
      new Response.Success({ articles }).send(res);
    }, (err) => {
      next(err);
    });
  }
);

router.post('/',
  (req, res, next) => {
    return Article.createNew({
      ipAddress: req.ipAddress,
      fullTitle: req.body.fullTitle,
      author: req.user,
      wikitext: req.body.wikitext,
      summary: req.body.summary
    })
    .then(() => {
      new Response.Created().send(res);
    })
    .catch((err) => {
      next(err);
    });
  }
);

/* rename article */
router.put('/full-title/:fullTitle/full-title',
  (req, res, next) => {
    return Article.findByFullTitle(req.params.fullTitle)
    .then((article) => {
      if (!article) {
        return new Response.ResourceNotFound().send(res);
      }
      if (req.params.fullTitle === req.body.fullTitle) {
        return new Response.BadRequest({ name: 'NoChangeError', message: 'No change' }).send(res);
      }
      return article.rename({
        ipAddress: req.ipAddress,
        author: req.user,
        newFullTitle: req.body.fullTitle,
        summary: req.body.summary
      })
      .then(() => {
        new Response.Success().send(res);
      });
    })
    .catch((err) => {
      next(err);
    });
  }
);

router.put('/full-title/:fullTitle/wikitext',
  (req, res, next) => {
    //@TODO Permission
    return Article.findByFullTitle(req.params.fullTitle)
    .then((article) => {
      if (!article) {
        return new Response.ResourceNotFound().send(res);
      }
      return article.getLatestRevision({ includeWikitext: true })
      .then((latestRevision) => {
        if (!req.body.latestRevisionId || latestRevision.id > req.body.latestRevisionId) {
          return new Response.BadRequest({ name: 'EditConflictError', message: 'edit conflict' }).send(res);
        }
        if (req.body.wikitext === latestRevision.wikitext.text) {
          return new Response.BadRequest({ name: 'NoChangeError', message: 'No change' }).send(res);
        }
        return article.edit({
          ipAddress: req.ipAddress,
          author: req.user,
          wikitext: req.body.wikitext,
          summary: req.body.summary
        })
        .then(() => {
          new Response.Success().send(res);
        });
      });
    })
    .catch((err) => {
      next(err);
    });
  }
);

router.get('/full-title/:fullTitle',
  (req, res, next) => {
    const fields = req.queryData.fields || ['namespaceId', 'title', 'updatedAt'];
    return Article.findByFullTitle(req.params.fullTitle)
    .then((article) => {
      const result = {};
      if (!article) {
        return new Response.ResourceNotFound().send(res);
      }
      return Promise.resolve()
      .then(() => {
        const promises = [];
        if (fields.includes('namespaceId')) {
          result.namespaceId = article.namespaceId;
        }
        if (fields.includes('title')) {
          result.title = article.title;
        }
        if (fields.includes('updatedAt')) {
          result.updatedAt = article.updatedAt;
        }
        if (fields.includes('fullTitle')) {
          result.fullTitle = article.fullTitle;
        }
        if (fields.includes('latestRevisionId')) {
          result.latestRevisionId = article.latestRevisionId;
        }
        if (fields.includes('wikitext')) {
          promises.push(
            article.getLatestRevision({ includeWikitext: true })
            .then((revision) => {
              result.wikitext = revision.wikitext.text;
            })
          );
        }
        if (fields.includes('html')) {
          promises.push(
            article.render()
            .then((renderResult) => {
              result.html = renderResult.html;
            })
          );
        }
        return Promise.all(promises);
      })
      .then(() => {
        new Response.Success({ article: result }).send(res);
      }, (err) => {
        console.log(err);
        next(err);
      });
    });
  }
);


/* delete article */
router.delete('/full-title/:fullTitle',
  (req, res, next) => {
    console.log("AFDSFDSFD");
    return Article.findByFullTitle(req.params.fullTitle)
    .then((article) => {
      if (!article) {
        return new Response.ResourceNotFound().send(res);
      }
      return article.delete({
        ipAddress: req.ipAddress,
        author: req.user,
        summary: req.body.summary
      })
      .then(() => {
        new Response.Success().send(res);
      });
    })
    .catch((err) => {
      next(err);
    });
  }
);




const findQuery = `(
	SELECT namespaceId, title, 0 as priority
	FROM articles
	WHERE namespaceId = :namespaceId AND title = :title AND deletedAt IS NULL
)
UNION ALL
(
	SELECT articles.namespaceId, articles.title, 1 as priority
	FROM redirections, articles
	WHERE sourceNamespaceId = :namespaceId AND sourceTitle = :title AND destinationArticleId = articles.id
)
UNION ALL
(
	SELECT namespaceId, title, 2 as priority
	FROM articles
	WHERE namespaceId = :namespaceId AND lowercaseTitle = :lowercaseTitle AND deletedAt IS NULL
)
UNION ALL
(
	SELECT articles.namespaceId, articles.title, 3 as priority
	FROM redirections, articles
	WHERE sourceNamespaceId = :namespaceId AND lowercaseSourceTitle = :lowercaseTitle AND destinationArticleId = articles.id
)
ORDER BY priority LIMIT 1`;

router.get('/full-title-ci/:fullTitle',
  (req, res, next) => {
    const { namespace, title } = Namespace.splitFullTitle(req.params.fullTitle);

    return sequelize.query(findQuery, {
      replacements: {
        namespaceId: namespace.id,
        title: title,
        lowercaseTitle: title.toLowerCase()
      }, type: sequelize.QueryTypes.SELECT
    })
    .then(([result]) => {
      if (result) {
        const fullTitle = Namespace.joinNamespaceIdTitle(result.namespaceId, result.title);
        switch (result.priority) {
          case 0:
            new Response.Success({ type: 'EXACT', fullTitle }).send(res);
            break;
          case 1:
            new Response.Success({ type: 'REDIRECTION', fullTitle }).send(res);
            break;
          case 2:
            new Response.Success({ type: 'CASE_INSENSITIVE', fullTitle }).send(res);
            break;
          case 3:
            new Response.Success({ type: 'CASE_INSENSITIVE_REDIRECTION', fullTitle }).send(res);
            break;
          default:
            throw new Error();
        }
      } else {
        new Response.ResourceNotFound().send(res);
      }
    });
  }
);


module.exports = router;